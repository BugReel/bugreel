/**
 * Pipeline — video-only (no audio stream) path.
 *
 * Verifies that a recording with no audio stream:
 *   - completes the pipeline without throwing
 *   - skips transcription and usage reporting
 *   - stores audio_filename = null
 *   - stores a non-null duration_seconds
 *   - ends with status = 'complete'
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { cleanupTestData } from '../setup.js';
import { initDB, getDB } from '../../db.js';
import { config } from '../../config.js';

// ---------------------------------------------------------------------------
// Mock all external I/O before importing pipeline.js
// ---------------------------------------------------------------------------

// extractAudio returns { duration: 42, hasAudio: false } to simulate a video-only file.
// extractFrame, compressVideo succeed silently.
// computeVisionMoments returns an empty array (no candidates).
vi.mock('../../services/ffmpeg.js', () => ({
  extractAudio: vi.fn().mockResolvedValue({ duration: 42, hasAudio: false }),
  compressVideo: vi.fn().mockResolvedValue({ originalSize: 1000, compressedSize: 800, ratio: 0.80 }),
  extractFrame: vi.fn().mockImplementation(async (_videoPath, _t, outputPath) => {
    // Create a minimal non-empty fake JPEG so the pipeline doesn't complain
    fs.writeFileSync(outputPath, Buffer.alloc(100, 1));
  }),
  trimVideo: vi.fn().mockResolvedValue(undefined),
  segmentVideo: vi.fn().mockResolvedValue(undefined),
}));

// transcribe should NOT be called for a no-audio recording.
const transcribeMock = vi.fn();
vi.mock('../../services/whisper.js', () => ({
  transcribe: (...args) => transcribeMock(...args),
}));

// classifyAndSummarize receives the empty transcript and returns a minimal result.
// analyzeTranscript should NOT be called (type won't be bug-like).
const classifyMock = vi.fn().mockResolvedValue({
  type: 'demo',
  title: 'Screen demo',
  summary: 'A silent screen recording.',
  chapters: [],
});
const analyzeMock = vi.fn();
vi.mock('../../services/gpt.js', () => ({
  classifyAndSummarize: (...args) => classifyMock(...args),
  analyzeTranscript: (...args) => analyzeMock(...args),
  extractActionItems: vi.fn().mockResolvedValue({ actionItems: [], decisions: [], openQuestions: [] }),
  extractKeyConcepts: vi.fn().mockResolvedValue({ concepts: [] }),
}));

// Vision moments: empty (no candidates extracted)
vi.mock('../../services/frame-select.js', () => ({
  computeVisionMoments: vi.fn().mockResolvedValue([]),
}));

const { enqueuePipeline } = await import('../../services/pipeline.js');

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeRecordingDir(id) {
  const dir = path.join(config.dataDir, id);
  fs.mkdirSync(path.join(dir, 'frames'), { recursive: true });
  // Create a dummy video file so fs.statSync inside compressVideo doesn't fail
  fs.writeFileSync(path.join(dir, 'video.webm'), Buffer.alloc(1000, 0));
  return dir;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeAll(() => {
  initDB();
});

afterAll(() => {
  try { getDB().close(); } catch {}
  cleanupTestData();
});

describe('Pipeline — no-audio recording', () => {
  it('completes successfully without calling transcribe', async () => {
    const db = getDB();
    const id = 'no-audio-' + crypto.randomUUID();

    db.prepare(`
      INSERT INTO recordings (id, author, status, share_token)
      VALUES (?, 'tester', 'uploaded', ?)
    `).run(id, crypto.randomUUID());

    makeRecordingDir(id);

    await enqueuePipeline(id);

    const rec = db.prepare('SELECT * FROM recordings WHERE id = ?').get(id);

    // Pipeline must finish without error
    expect(rec.status).toBe('complete');

    // Duration must be persisted
    expect(rec.duration_seconds).toBe(42);

    // audio_filename must be null (no audio extracted)
    expect(rec.audio_filename).toBeNull();

    // transcribe must NOT have been called
    expect(transcribeMock).not.toHaveBeenCalled();

    // classifyAndSummarize must have been called with an empty transcript
    expect(classifyMock).toHaveBeenCalledTimes(1);
    const [passedTranscript] = classifyMock.mock.calls[0];
    expect(passedTranscript.text).toBe('');
    expect(passedTranscript.words).toEqual([]);
    expect(passedTranscript.segments).toEqual([]);

    // analyzeTranscript must NOT have been called (type = 'demo', not bug-like)
    expect(analyzeMock).not.toHaveBeenCalled();

    // AI title/summary must have been stored
    expect(rec.ai_title).toBe('Screen demo');
    expect(rec.ai_type).toBe('demo');

    db.prepare('DELETE FROM recordings WHERE id = ?').run(id);
    db.prepare('DELETE FROM frames WHERE recording_id = ?').run(id);
  });
});
