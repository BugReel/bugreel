import path from 'path';
import fs from 'fs';
import { getDB } from '../db.js';
import { config } from '../config.js';
import { extractAudio, extractFrame, compressVideo, trimVideo, segmentVideo } from './ffmpeg.js';
import { transcribe } from './whisper.js';
import { analyzeTranscript } from './gpt.js';

/**
 * Best-effort notification to the Skrini cloud about AI usage. Used when Core
 * runs behind a paid-SaaS wrapper (skrini.ru). Does nothing when CLOUD_USAGE_URL
 * or INTERNAL_TOKEN is unset — Core can run standalone.
 *
 * @param {string} recordingId
 * @param {'transcription'|'analysis'} kind
 * @param {{minutes?: number, count?: number}} payload
 */
async function notifyUsage(recordingId, kind, payload = {}) {
  const url = process.env.CLOUD_USAGE_URL;
  const token = process.env.INTERNAL_TOKEN;
  if (!url || !token) return;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Token': token,
      },
      body: JSON.stringify({ recording_id: recordingId, kind, ...payload }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      console.warn(`[usage] ${kind} callback for ${recordingId} → ${res.status}`);
    }
  } catch (err) {
    // Never fail the pipeline because of usage reporting.
    console.warn(`[usage] ${kind} callback failed for ${recordingId}: ${err.message}`);
  }
}
// --- Concurrency queue: max 2 pipelines at once to avoid overloading CPU/RAM ---
const MAX_CONCURRENT = 2;
let running = 0;
const queue = [];

export function enqueuePipeline(recordingId) {
  return new Promise((resolve, reject) => {
    queue.push({ recordingId, resolve, reject });
    processQueue();
  });
}

function processQueue() {
  while (running < MAX_CONCURRENT && queue.length > 0) {
    const { recordingId, resolve, reject } = queue.shift();
    running++;
    processPipeline(recordingId)
      .then(resolve)
      .catch(reject)
      .finally(() => {
        running--;
        processQueue();
      });
  }
}

export function getQueueStatus() {
  return { running, queued: queue.length };
}

/**
 * Retry any recordings stuck in non-terminal states on server startup.
 * Resets them to 'uploaded' and re-enqueues.
 */
export function retryStuckRecordings() {
  const db = getDB();
  const stuck = db.prepare(
    "SELECT id FROM recordings WHERE status NOT IN ('complete', 'error', 'uploaded')"
  ).all();

  const uploaded = db.prepare(
    "SELECT id FROM recordings WHERE status = 'uploaded'"
  ).all();

  const toRetry = [...stuck, ...uploaded];
  if (!toRetry.length) return;

  // Reset stuck ones
  for (const { id } of stuck) {
    db.prepare("UPDATE recordings SET status = 'uploaded', transcript_json = NULL, analysis_json = NULL WHERE id = ?").run(id);
    db.prepare("DELETE FROM frames WHERE recording_id = ?").run(id);
    db.prepare("DELETE FROM cards WHERE recording_id = ?").run(id);
  }

  console.log(`[Pipeline] Retrying ${toRetry.length} recordings: ${toRetry.map(r => r.id).join(', ')}`);

  for (const { id } of toRetry) {
    enqueuePipeline(id).catch(err => {
      console.error(`Pipeline retry error for ${id}:`, err.message);
      db.prepare("UPDATE recordings SET status = 'error' WHERE id = ?").run(id);
    });
  }
}

/**
 * Main processing pipeline (optimized):
 *   1. Extract audio (fast, ~2-5s)
 *   2. In parallel: transcribe audio + compress video
 *   3. GPT analysis (needs transcript)
 *   4. Extract key frames (needs compressed video + keyFrames from analysis)
 *   5. Create card
 *
 * @param {string} recordingId
 */
async function processPipeline(recordingId) {
  const db = getDB();
  const recording = db.prepare('SELECT * FROM recordings WHERE id = ?').get(recordingId);

  if (!recording) {
    throw new Error(`Recording ${recordingId} not found`);
  }

  const recDir = path.join(config.dataDir, recordingId);
  const videoPath = path.join(recDir, 'video.webm');
  const audioPath = path.join(recDir, 'audio.mp3');

  // 0. Process video segments (trim + cuts)
  const segmentsJson = recording.segments_json;
  const trimStart = recording.trim_start;
  const trimEnd = recording.trim_end;
  if (segmentsJson) {
    const segments = JSON.parse(segmentsJson);
    if (segments.length > 0) {
      console.log(`[${recordingId}] Processing ${segments.length} segment(s): ${segments.map(s => `${s.start}→${s.end}`).join(', ')}`);
      await segmentVideo(videoPath, segments);
      console.log(`[${recordingId}] Segments processed`);
    }
  } else if (trimStart !== null && trimStart !== undefined && trimEnd !== null && trimEnd !== undefined) {
    // Backward compat: old trim_start/trim_end
    console.log(`[${recordingId}] Trimming video: ${trimStart}s → ${trimEnd}s`);
    await trimVideo(videoPath, trimStart, trimEnd);
    console.log(`[${recordingId}] Video trimmed`);
  }

  // 1. Extract audio first (fast — seconds, needed for transcription)
  console.log(`[${recordingId}] Extracting audio...`);
  db.prepare('UPDATE recordings SET status = ? WHERE id = ?').run('audio_extracted', recordingId);
  const duration = await extractAudio(videoPath, audioPath);
  db.prepare('UPDATE recordings SET audio_filename = ?, duration_seconds = ? WHERE id = ?')
    .run('audio.mp3', duration, recordingId);
  console.log(`[${recordingId}] Audio extracted, duration=${duration}s`);

  // 2. In parallel: transcribe + compress video
  console.log(`[${recordingId}] Starting transcription + compression in parallel...`);
  db.prepare('UPDATE recordings SET status = ? WHERE id = ?').run('transcribing', recordingId);

  const [transcript, compression] = await Promise.all([
    // Transcription (sends audio to Whisper API — network I/O)
    transcribe(audioPath).then(result => {
      db.prepare('UPDATE recordings SET transcript_json = ?, status = ? WHERE id = ?')
        .run(JSON.stringify(result), 'transcribed', recordingId);
      console.log(`[${recordingId}] Transcription complete`);
      // Fire-and-forget usage callback to cloud (no-op for standalone deployments).
      notifyUsage(recordingId, 'transcription', { minutes: Math.max(1, Math.round(duration / 60)) });
      return result;
    }),
    // Video compression (CPU-bound ffmpeg — runs in parallel with network call)
    compressVideo(videoPath).then(result => {
      db.prepare('UPDATE recordings SET file_size_bytes = ? WHERE id = ?')
        .run(result.compressedSize, recordingId);
      console.log(`[${recordingId}] Compression: ${(result.originalSize / 1048576).toFixed(1)}MB → ${(result.compressedSize / 1048576).toFixed(1)}MB (${Math.round(result.ratio * 100)}%)`);
      return result;
    })
  ]);

  // 3. GPT analysis (needs transcript + optional URL/console context)
  console.log(`[${recordingId}] Analyzing with GPT...`);

  // Parse URL events and console errors from recording (if captured by extension)
  let urlEvents = null;
  let consoleEvents = null;
  let actionEvents = null;
  try {
    if (recording.url_events_json) urlEvents = JSON.parse(recording.url_events_json);
  } catch {}
  try {
    if (recording.console_events_json) consoleEvents = JSON.parse(recording.console_events_json);
  } catch {}
  try {
    if (recording.action_events_json) actionEvents = JSON.parse(recording.action_events_json);
  } catch {}

  const analysis = await analyzeTranscript(transcript, urlEvents, consoleEvents, actionEvents, duration);
  db.prepare('UPDATE recordings SET analysis_json = ?, status = ? WHERE id = ?')
    .run(JSON.stringify(analysis), 'analyzed', recordingId);
  console.log(`[${recordingId}] Analysis complete: type=${analysis.type}, title="${analysis.title}"`);
  notifyUsage(recordingId, 'analysis', { count: 1 });

  // 4. Extract key frames (from compressed video)
  console.log(`[${recordingId}] Extracting key frames...`);
  const framesDir = path.join(recDir, 'frames');
  fs.mkdirSync(framesDir, { recursive: true });

  // Parse manual markers (user-pressed camera button during recording)
  let manualMarkers = [];
  try {
    if (recording.manual_markers_json) manualMarkers = JSON.parse(recording.manual_markers_json);
  } catch {}

  // Merge: manual markers take priority, GPT frames within 3s of a manual one are skipped
  const DEDUP_THRESHOLD = 3.0;
  // Clamp timestamps to video duration (GPT can hallucinate times beyond the end)
  const maxTime = duration > 0 ? Math.max(duration - 0.1, 0) : Infinity;
  const gptFrames = (analysis.keyFrames || []).map(f => ({ time: Math.min(Math.max(f.time, 0), maxTime), description: f.description, detail: f.detail || '', isManual: false }));
  const mergedFrames = [
    ...manualMarkers.map(m => ({ time: m.ts, description: 'Manual screenshot', isManual: true })),
    ...gptFrames.filter(gpt =>
      !manualMarkers.some(m => Math.abs(m.ts - gpt.time) <= DEDUP_THRESHOLD)
    )
  ].sort((a, b) => a.time - b.time).slice(0, config.maxScreenshots);

  if (manualMarkers.length > 0) {
    console.log(`[${recordingId}] Manual markers: ${manualMarkers.length}, GPT frames: ${gptFrames.length}, merged: ${mergedFrames.length}`);
  }

  for (let i = 0; i < mergedFrames.length; i++) {
    const frame = mergedFrames[i];
    const filename = `${String(i + 1).padStart(3, '0')}_${frame.time.toFixed(1)}s.jpg`;
    const framePath = path.join(framesDir, filename);

    await extractFrame(videoPath, frame.time, framePath);

    db.prepare('INSERT INTO frames (recording_id, time_seconds, description, detail, filename, is_manual) VALUES (?, ?, ?, ?, ?, ?)')
      .run(recordingId, frame.time, frame.description, frame.detail || '', filename, frame.isManual ? 1 : 0);
  }
  db.prepare('UPDATE recordings SET status = ? WHERE id = ?').run('frames_extracted', recordingId);
  console.log(`[${recordingId}] Extracted ${mergedFrames.length} frames`);

  // 5. Create card
  console.log(`[${recordingId}] Creating card...`);
  const description = formatDescription(analysis);
  const cardResult = db.prepare(`
    INSERT INTO cards (recording_id, type, title, description, summary, status)
    VALUES (?, ?, ?, ?, ?, 'draft')
  `).run(
    recordingId,
    analysis.type || 'bug',
    analysis.title || 'Untitled',
    description,
    analysis.summary || null
  );
  const cardId = cardResult.lastInsertRowid;
  console.log(`[${recordingId}] Card #${cardId} created`);

  // 6. Done (YouTrack export is manual — via POST /api/cards/:id/export-youtrack)
  db.prepare('UPDATE recordings SET status = ? WHERE id = ?').run('complete', recordingId);
  console.log(`[${recordingId}] Pipeline complete!`);

  // Cleanup: audio.mp3 no longer needed after transcription
  try { fs.unlinkSync(audioPath); } catch {}
}

/**
 * Format analysis result into a human-readable markdown description.
 */
export function formatDescription(analysis) {
  let desc = '';
  const type = analysis.type || 'bug';

  if (type === 'bug') {
    if (analysis.steps?.length) {
      desc += '## Steps to Reproduce\n';
      for (const step of analysis.steps) desc += `${step}\n`;
      desc += '\n';
    }
    if (analysis.expected) desc += `## Expected Result\n${analysis.expected}\n\n`;
    if (analysis.actual) desc += `## Actual Result\n${analysis.actual}\n\n`;
  } else if (type === 'feature') {
    if (analysis.proposal) desc += `## Proposal\n${analysis.proposal}\n\n`;
    if (analysis.use_case) desc += `## Use Case\n${analysis.use_case}\n\n`;
  } else if (type === 'enhancement') {
    // New format: arrays
    if (analysis.observations?.length) {
      desc += '## Observations\n';
      for (let i = 0; i < analysis.observations.length; i++) {
        desc += `${i + 1}. ${analysis.observations[i]}\n`;
      }
      desc += '\n';
    } else if (analysis.current_behavior) {
      // Legacy fallback: string
      desc += `## Current Behavior\n${analysis.current_behavior}\n\n`;
    }
    if (analysis.suggestions?.length) {
      desc += '## Suggestions\n';
      for (let i = 0; i < analysis.suggestions.length; i++) {
        desc += `${i + 1}. ${analysis.suggestions[i]}\n`;
      }
      desc += '\n';
    } else if (analysis.proposed_change) {
      desc += `## Proposed Change\n${analysis.proposed_change}\n\n`;
    }
  } else if (type === 'demo') {
    if (analysis.key_points?.length) {
      desc += '## Key Points\n';
      for (const point of analysis.key_points) desc += `- ${point}\n`;
      desc += '\n';
    }
    if (analysis.details) desc += `## Details\n${analysis.details}\n\n`;
  }

  // Common fields for all types
  if (analysis.context) desc += `## Context\n${analysis.context}\n\n`;

  // Business context and severity (extracted by GPT from speech)
  if (analysis.business_context || analysis.severity || analysis.affected_module) {
    desc += '## Metadata\n';
    if (analysis.severity) desc += `**Severity:** ${analysis.severity}\n`;
    if (analysis.affected_module) desc += `**Module:** ${analysis.affected_module}\n`;
    if (analysis.business_context) desc += `**Business Context:** ${analysis.business_context}\n`;
    desc += '\n';
  }

  // Additional issues found in the same recording
  if (analysis.additional_issues?.length) {
    desc += '## Additional Issues\n';
    for (const issue of analysis.additional_issues) {
      const time = issue.time ? ` (${Math.floor(issue.time / 60)}:${String(Math.floor(issue.time % 60)).padStart(2, '0')})` : '';
      desc += `- **${issue.title}**${time}: ${issue.description}\n`;
    }
    desc += '\n';
  }

  if (analysis.affected_urls?.length) {
    desc += `## Affected Pages\n`;
    for (const url of analysis.affected_urls) desc += `- ${url}\n`;
    desc += '\n';
  }

  if (analysis.error_context) desc += `## Console Errors\n${analysis.error_context}\n`;

  return desc;
}
