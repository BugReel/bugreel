/**
 * Pipeline — key-frame extraction failure must not abort the recording.
 *
 * A timestamp near EOF on a sparse-keyframe WebM can make ffmpeg emit an empty
 * frame (extractFrame throws). The transcript, title, summary and chapters are
 * already persisted by that point, so a single bad frame must NOT discard the
 * whole recording. This test makes EVERY extractFrame call throw and asserts the
 * pipeline still ends at status 'complete' with zero frame rows.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { cleanupTestData } from '../setup.js';
import { initDB, getDB } from '../../db.js';
import { config } from '../../config.js';

// extractFrame always throws — simulates an out-of-range / empty-output seek.
vi.mock('../../services/ffmpeg.js', () => ({
  extractAudio: vi.fn().mockResolvedValue({ duration: 26, hasAudio: true }),
  compressVideo: vi.fn().mockResolvedValue({ originalSize: 1000, compressedSize: 800, ratio: 0.80 }),
  extractFrame: vi.fn().mockRejectedValue(new Error('ffmpeg extractFrame produced empty output at 28.3s')),
  trimVideo: vi.fn().mockResolvedValue(undefined),
  segmentVideo: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../services/whisper.js', () => ({
  transcribe: vi.fn().mockResolvedValue({ title: 'Demo', text: 'hello world', words: [], segments: [] }),
}));

// One chapter so the chapter-thumb loop (already guarded) also runs and fails.
const classifyMock = vi.fn().mockResolvedValue({
  type: 'demo',
  title: 'Проверка распознавания ключевых кадров',
  summary: 'A short demo.',
  chapters: [{ time: 1, title: 'Intro' }],
});
vi.mock('../../services/gpt.js', () => ({
  classifyAndSummarize: (...args) => classifyMock(...args),
  analyzeTranscript: vi.fn(),
  extractActionItems: vi.fn().mockResolvedValue({ actionItems: [], decisions: [], openQuestions: [] }),
  extractKeyConcepts: vi.fn().mockResolvedValue({ concepts: [] }),
}));

// One vision moment past the (clamped) end so a key frame is queued and then fails.
vi.mock('../../services/frame-select.js', () => ({
  computeVisionMoments: vi.fn().mockResolvedValue([{ time: 25, description: 'screen' }]),
}));

const { enqueuePipeline } = await import('../../services/pipeline.js');

function makeRecordingDir(id) {
  const dir = path.join(config.dataDir, id);
  fs.mkdirSync(path.join(dir, 'frames'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'video.webm'), Buffer.alloc(1000, 0));
  return dir;
}

beforeAll(() => { initDB(); });
afterAll(() => {
  try { getDB().close(); } catch {}
  cleanupTestData();
});

describe('Pipeline — key-frame extraction failure', () => {
  it('completes the recording even when every frame extraction throws', async () => {
    const db = getDB();
    const id = 'frame-fail-' + crypto.randomUUID();

    // Manual marker at 28.3s on a 26s video — exactly the REC-2026-0058 shape.
    db.prepare(`
      INSERT INTO recordings (id, author, status, share_token, manual_markers_json)
      VALUES (?, 'tester', 'uploaded', ?, ?)
    `).run(id, crypto.randomUUID(), JSON.stringify([{ ts: 28.3 }]));

    makeRecordingDir(id);

    // Must not reject (a frame failure used to throw out of the pipeline)
    await enqueuePipeline(id);

    const rec = db.prepare('SELECT * FROM recordings WHERE id = ?').get(id);

    // The whole point: a frame failure no longer kills the pipeline.
    expect(rec.status).toBe('complete');

    // AI output (the expensive work) survived.
    expect(rec.ai_title).toBe('Проверка распознавания ключевых кадров');
    expect(rec.ai_type).toBe('demo');

    // No frame rows were inserted (every extraction failed and was skipped).
    const frameCount = db.prepare('SELECT COUNT(*) c FROM frames WHERE recording_id = ?').get(id).c;
    expect(frameCount).toBe(0);

    db.prepare('DELETE FROM recordings WHERE id = ?').run(id);
    db.prepare('DELETE FROM frames WHERE recording_id = ?').run(id);
  });
});
