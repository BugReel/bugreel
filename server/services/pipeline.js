import path from 'path';
import fs from 'fs';
import { getDB } from '../db.js';
import { config } from '../config.js';
import { extractAudio, extractFrame, compressVideo, trimVideo, segmentVideo } from './ffmpeg.js';
import { transcribe } from './whisper.js';
import { analyzeTranscript, classifyAndSummarize, extractActionItems, extractKeyConcepts } from './gpt.js';
import { computeVisionMoments } from './frame-select.js';

// Recording types that get the legacy bug-card + YouTrack export flow.
const BUG_LIKE_TYPES = new Set(['bug', 'feature', 'enhancement']);
const MEETING_TYPES = new Set(['meeting']);
const LESSON_TYPES = new Set(['tutorial', 'walkthrough', 'lesson']);

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
    db.prepare(`UPDATE recordings SET
      status = 'uploaded',
      transcript_json = NULL,
      analysis_json = NULL,
      ai_type = NULL,
      ai_title = NULL,
      ai_summary = NULL,
      ai_chapters_json = NULL,
      ai_action_items_json = NULL,
      ai_key_concepts_json = NULL,
      thumbnail_filename = NULL
      WHERE id = ?`).run(id);
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
  const { duration, hasAudio } = await extractAudio(videoPath, audioPath);
  db.prepare('UPDATE recordings SET audio_filename = ?, duration_seconds = ? WHERE id = ?')
    .run(hasAudio ? 'audio.mp3' : null, duration, recordingId);
  if (!hasAudio) {
    console.log(`[${recordingId}] No audio stream detected — transcription skipped`);
  }
  console.log(`[${recordingId}] Audio extracted, duration=${duration}s, hasAudio=${hasAudio}`);

  // 2. In parallel: transcribe (when audio present) + compress video
  console.log(`[${recordingId}] Starting ${hasAudio ? 'transcription + ' : ''}compression...`);
  db.prepare('UPDATE recordings SET status = ? WHERE id = ?').run('transcribing', recordingId);

  // Empty transcript shape matching the real transcribe() return value
  // ({ title, text, words, segments }) so downstream consumers never see undefined.
  const EMPTY_TRANSCRIPT = { title: '', text: '', words: [], segments: [] };

  const [transcript, compression] = await Promise.all([
    // Transcription (sends audio to Whisper API — network I/O); skipped for video-only recordings.
    hasAudio
      ? transcribe(audioPath).then(result => {
          db.prepare('UPDATE recordings SET transcript_json = ?, status = ? WHERE id = ?')
            .run(JSON.stringify(result), 'transcribed', recordingId);
          console.log(`[${recordingId}] Transcription complete`);
          // Fire-and-forget usage callback to cloud (no-op for standalone deployments).
          notifyUsage(recordingId, 'transcription', { minutes: Math.max(1, Math.round(duration / 60)) });
          return result;
        })
      : Promise.resolve(EMPTY_TRANSCRIPT),
    // Video compression (CPU-bound ffmpeg — runs in parallel with network call)
    compressVideo(videoPath).then(result => {
      db.prepare('UPDATE recordings SET file_size_bytes = ? WHERE id = ?')
        .run(result.compressedSize, recordingId);
      console.log(`[${recordingId}] Compression: ${(result.originalSize / 1048576).toFixed(1)}MB → ${(result.compressedSize / 1048576).toFixed(1)}MB (${Math.round(result.ratio * 100)}%)`);
      return result;
    })
  ]);

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

  // 3. First-pass: classify recording type + generic summary/chapters.
  // Runs for EVERY recording (bug, lesson, meeting, demo, ...). The result drives
  // which type-specific extractor (if any) runs next.
  console.log(`[${recordingId}] Classifying recording + generating summary/chapters...`);
  const classification = await classifyAndSummarize(transcript, duration, urlEvents, consoleEvents, actionEvents);
  db.prepare(
    'UPDATE recordings SET ai_type = ?, ai_title = ?, ai_summary = ?, ai_chapters_json = ? WHERE id = ?'
  ).run(
    classification.type,
    classification.title,
    classification.summary || null,
    JSON.stringify(classification.chapters || []),
    recordingId
  );
  console.log(`[${recordingId}] Classified as ${classification.type}: "${classification.title}" (${(classification.chapters || []).length} chapters)`);
  notifyUsage(recordingId, 'analysis', { count: 1 });

  // 4. Type-specific deep extraction.
  let analysis = null;          // legacy bug-card analysis (only for BUG_LIKE_TYPES)
  let actionItemsResult = null; // meeting payload
  let conceptsResult = null;    // lesson/tutorial payload
  const aiType = classification.type;

  if (BUG_LIKE_TYPES.has(aiType)) {
    console.log(`[${recordingId}] Running bug-card analysis (analyzeTranscript)...`);
    analysis = await analyzeTranscript(transcript, urlEvents, consoleEvents, actionEvents, duration);
    db.prepare('UPDATE recordings SET analysis_json = ? WHERE id = ?')
      .run(JSON.stringify(analysis), recordingId);
    notifyUsage(recordingId, 'analysis', { count: 1 });
  } else if (MEETING_TYPES.has(aiType)) {
    console.log(`[${recordingId}] Extracting action items / decisions / open questions...`);
    try {
      actionItemsResult = await extractActionItems(transcript, classification.chapters || [], duration);
      db.prepare('UPDATE recordings SET ai_action_items_json = ? WHERE id = ?')
        .run(JSON.stringify(actionItemsResult), recordingId);
      notifyUsage(recordingId, 'analysis', { count: 1 });
    } catch (err) {
      console.warn(`[${recordingId}] extractActionItems failed: ${err.message}`);
    }
  } else if (LESSON_TYPES.has(aiType)) {
    console.log(`[${recordingId}] Extracting key concepts / learning goals / practical steps...`);
    try {
      conceptsResult = await extractKeyConcepts(transcript, classification.chapters || [], urlEvents, actionEvents, duration);
      db.prepare('UPDATE recordings SET ai_key_concepts_json = ? WHERE id = ?')
        .run(JSON.stringify(conceptsResult), recordingId);
      notifyUsage(recordingId, 'analysis', { count: 1 });
    } catch (err) {
      console.warn(`[${recordingId}] extractKeyConcepts failed: ${err.message}`);
    }
  }
  db.prepare('UPDATE recordings SET status = ? WHERE id = ?').run('analyzed', recordingId);

  // 5. Extract key frames. Source depends on recording type:
  //    - bug/feature/enhancement: GPT keyFrames (existing behaviour)
  //    - manual markers always merged in, take priority.
  // Chapters are NOT turned into frames here — they get their own per-chapter
  // thumbnails in step 5b and merge into the unified moments list on the client.
  console.log(`[${recordingId}] Extracting key frames...`);
  const framesDir = path.join(recDir, 'frames');
  fs.mkdirSync(framesDir, { recursive: true });

  let manualMarkers = [];
  try {
    if (recording.manual_markers_json) manualMarkers = JSON.parse(recording.manual_markers_json);
  } catch {}

  const maxTime = duration > 0 ? Math.max(duration - 0.1, 0) : Infinity;
  const clampTime = t => Math.min(Math.max(Number(t) || 0, 0), maxTime);

  // Vision-based moment selection: the model SEES dense candidate frames and picks
  // the distinct meaningful screen states (+ captions) instead of guessing timestamps
  // from transcript text. Used for (a) bug-card key frames and (b) snapping chapter
  // thumbnails to a meaningful nearby frame. Degrades gracefully on any failure.
  // Canon: docs/frame-selection-vision.md.
  const visionMoments = await computeVisionMoments(videoPath, framesDir, transcript, duration, recordingId);

  // Snap a timestamp to the nearest meaningful vision moment within the configured
  // window (used for chapter thumbnails — a chapter boundary often lands on a
  // transition/blank frame). Returns the original time if no moment is near.
  const snapToMoment = (t) => {
    if (!visionMoments.length) return t;
    let best = t, bestD = Infinity;
    for (const m of visionMoments) {
      const d = Math.abs(m.time - t);
      if (d < bestD) { bestD = d; best = m.time; }
    }
    return bestD <= config.frameSelect.chapterSnapWindow ? best : t;
  };

  // Key frames source (bug-like recordings only — analysis is null for other types):
  // prefer vision moments, fall back to the blind text-based keyFrames.
  let gptFrames = [];
  if (analysis) {
    const source = visionMoments.length > 0
      ? visionMoments
      : (Array.isArray(analysis.keyFrames) ? analysis.keyFrames : []);
    gptFrames = source.map(f => ({
      time: clampTime(f.time),
      description: f.description || '',
      detail: f.detail || '',
      isManual: false,
    }));
  }

  const DEDUP_THRESHOLD = 3.0;
  let mergedFrames = [
    ...manualMarkers.map(m => ({ time: m.ts, description: 'Manual screenshot', detail: '', isManual: true })),
    ...gptFrames.filter(gpt =>
      !manualMarkers.some(m => Math.abs(m.ts - gpt.time) <= DEDUP_THRESHOLD)
    )
  ].sort((a, b) => a.time - b.time);

  // Cross-source dedup (near-identical times, e.g. vision-window boundaries)
  const deduped = [];
  for (const f of mergedFrames) {
    if (!deduped.some(d => Math.abs(d.time - f.time) <= DEDUP_THRESHOLD)) deduped.push(f);
  }
  mergedFrames = deduped;

  // Count is decided by the vision model (long video = more moments); maxScreenshots>0
  // is an explicit env cap, otherwise only a runaway safety ceiling applies.
  const ceiling = config.maxScreenshots > 0
    ? config.maxScreenshots
    : (config.maxScreenshotsCeiling > 0 ? config.maxScreenshotsCeiling : mergedFrames.length);
  if (mergedFrames.length > ceiling) {
    console.log(`[${recordingId}] Capping ${mergedFrames.length} -> ${ceiling} frames (safety ceiling)`);
    mergedFrames = mergedFrames.slice(0, ceiling);
  }

  if (manualMarkers.length > 0) {
    console.log(`[${recordingId}] Manual markers: ${manualMarkers.length}, AI frames: ${gptFrames.length}, merged: ${mergedFrames.length}`);
  }

  const frameFilenames = [];
  for (let i = 0; i < mergedFrames.length; i++) {
    const frame = mergedFrames[i];
    const filename = `${String(i + 1).padStart(3, '0')}_${frame.time.toFixed(1)}s.jpg`;
    const framePath = path.join(framesDir, filename);

    await extractFrame(videoPath, frame.time, framePath);
    frameFilenames.push({ filename, time: frame.time, isManual: frame.isManual });

    db.prepare('INSERT INTO frames (recording_id, time_seconds, description, detail, filename, is_manual) VALUES (?, ?, ?, ?, ?, ?)')
      .run(recordingId, frame.time, frame.description, frame.detail || '', filename, frame.isManual ? 1 : 0);
  }
  db.prepare('UPDATE recordings SET status = ? WHERE id = ?').run('frames_extracted', recordingId);
  console.log(`[${recordingId}] Extracted ${mergedFrames.length} frames`);

  // 5b. Per-chapter thumbnails. Each chapter gets one frame so the client can
  // render the unified moments list (chapters + manual frames) with previews.
  // Stored in the same frames dir + served by /frames/:filename. The thumb
  // filename is written back into ai_chapters_json (no schema change needed).
  let chapterThumbs = [];
  if (Array.isArray(classification.chapters) && classification.chapters.length > 0) {
    const chapters = classification.chapters.slice(0, 50);
    for (let i = 0; i < chapters.length; i++) {
      const ch = chapters[i];
      // ch.time stays the navigation seek point; the THUMBNAIL is snapped to the
      // nearest meaningful vision moment so it isn't a transition/blank frame.
      const tThumb = clampTime(snapToMoment(clampTime(ch.time)));
      const filename = `ch_${String(i + 1).padStart(3, '0')}_${tThumb.toFixed(1)}s.jpg`;
      try {
        await extractFrame(videoPath, tThumb, path.join(framesDir, filename));
        chapters[i] = { ...ch, thumb: filename };
      } catch (err) {
        console.warn(`[${recordingId}] chapter thumb ${i} failed: ${err.message}`);
        chapters[i] = { ...ch };
      }
    }
    chapterThumbs = chapters;
    db.prepare('UPDATE recordings SET ai_chapters_json = ? WHERE id = ?')
      .run(JSON.stringify(chapters), recordingId);
    console.log(`[${recordingId}] Chapter thumbs: ${chapters.filter(c => c.thumb).length}/${chapters.length}`);
  }

  // 6. Smart thumbnail — prefer the first non-manual AI frame (most representative),
  // fall back to first chapter thumb, then first manual marker, then ~25% of duration.
  let thumbnailFilename = null;
  const aiFrame = frameFilenames.find(f => !f.isManual);
  const anyFrame = frameFilenames[0];
  const firstChapterThumb = chapterThumbs.find(c => c.thumb)?.thumb || null;
  if (aiFrame) {
    thumbnailFilename = aiFrame.filename;
  } else if (firstChapterThumb) {
    thumbnailFilename = firstChapterThumb;
  } else if (anyFrame) {
    thumbnailFilename = anyFrame.filename;
  } else if (duration > 0) {
    const t = Math.min(duration * 0.25, Math.max(duration - 1, 0));
    const filename = `thumb_${t.toFixed(1)}s.jpg`;
    try {
      await extractFrame(videoPath, t, path.join(framesDir, filename));
      thumbnailFilename = filename;
    } catch (err) {
      console.warn(`[${recordingId}] thumbnail fallback failed: ${err.message}`);
    }
  }
  if (thumbnailFilename) {
    db.prepare('UPDATE recordings SET thumbnail_filename = ? WHERE id = ?').run(thumbnailFilename, recordingId);
    console.log(`[${recordingId}] Thumbnail: ${thumbnailFilename}`);
  }

  // 7. Create tracker card — only for bug-like recordings (kept compatible with YouTrack export).
  if (analysis && BUG_LIKE_TYPES.has(aiType)) {
    console.log(`[${recordingId}] Creating tracker card...`);
    const description = formatDescription(analysis);
    const cardResult = db.prepare(`
      INSERT INTO cards (recording_id, type, title, description, summary, status)
      VALUES (?, ?, ?, ?, ?, 'draft')
    `).run(
      recordingId,
      analysis.type || aiType,
      analysis.title || classification.title || 'Untitled',
      description,
      analysis.summary || classification.summary || null
    );
    console.log(`[${recordingId}] Card #${cardResult.lastInsertRowid} created`);
  }

  // 8. Done. YouTrack export remains manual (POST /api/cards/:id/export-youtrack).
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
