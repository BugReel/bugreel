import { config } from '../config.js';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  splitTranscriptIntoChunks,
  dedupeByTime,
  CHUNKING_THRESHOLD_SEC,
} from './transcript-chunks.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadPrompt(name) {
  return fs.readFileSync(path.join(__dirname, '..', 'prompts', name), 'utf-8');
}

function formatTimestampedWords(words) {
  return (words || [])
    .map(w => `[${w.start.toFixed(1)}s] ${w.word}`)
    .join(' ');
}

function formatUrlEvents(urlEvents) {
  if (!urlEvents || urlEvents.length === 0) return '';
  const lines = urlEvents.map(e => {
    const ts = (e.ts ?? e.time ?? 0);
    const title = e.title ? ` (${e.title})` : '';
    const type = e.type ? ` [${e.type}]` : '';
    return `[${Number(ts).toFixed(1)}s] ${e.url}${title}${type}`;
  }).join('\n');
  return `\n\n--- URL Events ---\n${lines}`;
}

function formatConsoleEvents(consoleEvents) {
  if (!consoleEvents || consoleEvents.length === 0) return '';
  const lines = consoleEvents.map(e => {
    const ts = (e.ts ?? e.time ?? 0);
    const level = (e.level ?? e.type ?? 'error').toUpperCase();
    const text = e.text ?? e.message ?? '';
    const source = e.source ? ` (${e.source})` : '';
    return `[${Number(ts).toFixed(1)}s] ${level}: ${text}${source}`;
  }).join('\n');
  return `\n\n--- Console Errors ---\n${lines}`;
}

function formatActionEvents(actionEvents) {
  if (!actionEvents || actionEvents.length === 0) return '';
  const ACTION_LABELS = { click: 'click', modal_open: 'modal open', modal_close: 'modal close', form_submit: 'form submit', text_select: 'select' };
  const lines = actionEvents.map(e => {
    const ts = Number(e.ts ?? 0).toFixed(1);
    const type = ACTION_LABELS[e.eventType] || e.eventType;
    const label = (e.ariaLabel || e.text || '').slice(0, 40);
    const tag = e.tag || '';
    const p = e.path ? e.path.split('>').pop().trim() : '';
    return `[${ts}s] ${type} <${tag}> "${label}" ${p}`;
  }).join('\n');
  return `\n\n--- User Actions (UI events, not user speech) ---\n${lines}`;
}

function formatChapters(chapters) {
  if (!Array.isArray(chapters) || chapters.length === 0) return '';
  const lines = chapters
    .map(c => `[${Number(c.time ?? 0).toFixed(1)}s] ${c.title || ''}`)
    .join('\n');
  return `\n\n--- Chapters ---\n${lines}`;
}

async function callGptJson(systemPrompt, userMessage, extraNudge = null) {
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ];
  if (extraNudge) messages.push({ role: 'user', content: extraNudge });

  const res = await fetch(config.gpt.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.gpt.apiKey}`,
    },
    body: JSON.stringify({
      model: config.gpt.model,
      messages,
      response_format: { type: 'json_object' },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GPT error ${res.status}: ${body}`);
  }
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Analyze a transcript using GPT to produce a structured bug/feature card.
 * @param {{ text: string, title?: string, words?: Array<{word: string, start: number, end: number}> }} transcript
 * @param {Array<{time: number, url: string, title?: string, type?: string}>|null} [urlEvents] - URL navigation events
 * @param {Array<{time: number, type: string, message: string, source?: string}>|null} [consoleEvents] - Console errors
 * @returns {{ type: string, title: string, steps: string[], expected?: string, actual?: string, context?: string, keyFrames: Array<{time: number, description: string}>, affected_urls?: string[], error_context?: string }}
 */
export async function analyzeTranscript(transcript, urlEvents = null, consoleEvents = null, actionEvents = null, durationSeconds = null) {
  const systemPrompt = loadPrompt('analyze-transcript.txt');
  const wordsWithTime = formatTimestampedWords(transcript.words);

  let userMessage = '';
  if (durationSeconds != null && durationSeconds > 0) {
    userMessage += `Video duration: ${durationSeconds} seconds\n\n`;
  }
  userMessage += `Video transcript:\n\n${transcript.text}\n\nWith timestamps:\n${wordsWithTime}`;
  userMessage += formatUrlEvents(urlEvents);
  userMessage += formatConsoleEvents(consoleEvents);
  userMessage += formatActionEvents(actionEvents);

  let analysis;
  try {
    analysis = await callGptJson(systemPrompt, userMessage);
  } catch (err) {
    throw new Error(`GPT request failed: ${err.message}`);
  }

  if (!analysis) {
    return { type: 'bug', title: transcript.title || 'Untitled', steps: [], keyFrames: [] };
  }

  // Retry once if GPT ignored the "keyFrames MUST contain 3-7 items" rule.
  // If the retry also fails, leave keyFrames empty so the UI surfaces the gap
  // (synthetic equi-spaced frames would hide the failure behind noise).
  const hasKeyFrames = Array.isArray(analysis.keyFrames) && analysis.keyFrames.length > 0;
  if (!hasKeyFrames) {
    try {
      const retry = await callGptJson(
        systemPrompt,
        userMessage,
        'Your previous response was missing the required `keyFrames` field. Return the SAME analysis again as strict JSON, this time including `keyFrames` with 3-7 items. Each item must have `time` (seconds, within the video duration), `description` (3-5 words), and `detail` (1-2 sentences). Do not change anything else.'
      );
      if (retry && Array.isArray(retry.keyFrames) && retry.keyFrames.length > 0) {
        analysis.keyFrames = retry.keyFrames;
      } else if (!Array.isArray(analysis.keyFrames)) {
        analysis.keyFrames = [];
      }
    } catch {
      if (!Array.isArray(analysis.keyFrames)) analysis.keyFrames = [];
    }
  }

  return analysis;
}

// Normalize chapter list: clamp to duration, drop entries lacking a title,
// sort strictly by time, drop near-duplicates within `minGapSec` of each other.
function sanitizeChapters(chapters, durationSeconds, minGapSec = 5) {
  if (!Array.isArray(chapters)) return [];
  const maxTime = durationSeconds && durationSeconds > 0 ? Math.max(0, durationSeconds - 1) : Infinity;
  const cleaned = chapters
    .filter(c => c && typeof c.title === 'string' && c.title.trim())
    .map(c => ({
      time: Math.max(0, Math.min(Number(c.time) || 0, maxTime)),
      title: String(c.title).trim(),
    }))
    .sort((a, b) => a.time - b.time);
  // Drop chapters closer than minGapSec to the previous one — usually duplicates
  // from overlapping chunks where two chunks both flagged the same boundary.
  const out = [];
  for (const c of cleaned) {
    const prev = out[out.length - 1];
    if (prev && c.time - prev.time < minGapSec) {
      // Prefer the more specific (longer) title.
      if (c.title.length > prev.title.length) out[out.length - 1] = c;
      continue;
    }
    out.push(c);
  }
  return out;
}

/**
 * Single-pass classify+summarize: runs the legacy "give the whole transcript
 * to GPT in one shot" path. Used directly for short recordings and as the
 * fallback when the chunked path fails.
 */
async function classifyAndSummarizeSinglePass(transcript, durationSeconds, urlEvents, consoleEvents, actionEvents) {
  const systemPrompt = loadPrompt('analyze-recording.txt');
  const wordsWithTime = formatTimestampedWords(transcript.words);

  let userMessage = '';
  if (durationSeconds != null && durationSeconds > 0) {
    userMessage += `Video duration: ${durationSeconds} seconds\n\n`;
  }
  userMessage += `Transcription:\n\n${transcript.text}\n\nWord-level timestamps:\n${wordsWithTime}`;
  userMessage += formatUrlEvents(urlEvents);
  userMessage += formatConsoleEvents(consoleEvents);
  userMessage += formatActionEvents(actionEvents);

  const result = await callGptJson(systemPrompt, userMessage);
  if (!result || typeof result !== 'object') {
    return { type: 'other', title: transcript.title || 'Untitled', summary: '', chapters: [] };
  }

  const type = typeof result.type === 'string' ? result.type : 'other';
  const title = typeof result.title === 'string' && result.title.trim() ? result.title.trim() : (transcript.title || 'Untitled');
  const summary = typeof result.summary === 'string' ? result.summary.trim() : '';
  const chapters = sanitizeChapters(result.chapters, durationSeconds);

  return { type, title, summary, chapters };
}

/**
 * Chunked classify+summarize: map step calls analyze-recording-chunk on each
 * time-bounded chunk in parallel, reduce step calls analyze-recording-reduce
 * to merge per-chunk votes/summaries/chapter candidates into one final result.
 *
 * gpt-4o-mini can't reliably attend to >15 min of word-level transcript at
 * once — it tends to space chapters at round intervals when the input is too
 * long. Chunking gives each pass a small enough window to actually find topic
 * boundaries.
 */
async function classifyAndSummarizeChunked(transcript, durationSeconds, urlEvents, consoleEvents, actionEvents) {
  const chunks = splitTranscriptIntoChunks(transcript, durationSeconds, {
    urlEvents, consoleEvents, actionEvents,
  });
  const chunkSystemPrompt = loadPrompt('analyze-recording-chunk.txt');

  const chunkResults = await Promise.all(chunks.map(async (chunk) => {
    const wordsWithTime = formatTimestampedWords(chunk.words);
    let userMessage = `Chunk start time: ${chunk.startSec.toFixed(1)} seconds\n`;
    userMessage += `Chunk end time: ${chunk.endSec.toFixed(1)} seconds\n`;
    userMessage += `Full video duration: ${durationSeconds} seconds\n\n`;
    userMessage += `Transcription (this chunk only):\n\n${chunk.text}\n\nWord-level timestamps (absolute):\n${wordsWithTime}`;
    userMessage += formatUrlEvents(chunk.urlEvents);
    userMessage += formatConsoleEvents(chunk.consoleEvents);
    userMessage += formatActionEvents(chunk.actionEvents);

    try {
      const res = await callGptJson(chunkSystemPrompt, userMessage);
      return {
        startSec: chunk.startSec,
        endSec: chunk.endSec,
        typeVotes: (res && typeof res.typeVotes === 'object') ? res.typeVotes : {},
        summary: (res && typeof res.summary === 'string') ? res.summary.trim() : '',
        chapters: (res && Array.isArray(res.chapters)) ? res.chapters : [],
      };
    } catch {
      return { startSec: chunk.startSec, endSec: chunk.endSec, typeVotes: {}, summary: '', chapters: [] };
    }
  }));

  // Aggregate candidate chapters across chunks, then dedupe near-boundary
  // duplicates from the 30s overlap. Pass the candidates to the reducer so it
  // picks the final list without inventing new timestamps.
  const allCandidates = sanitizeChapters(
    chunkResults.flatMap(r => r.chapters),
    durationSeconds,
    10, // collapse candidates within 10s — overlap region noise
  );

  const reducerSystemPrompt = loadPrompt('analyze-recording-reduce.txt');
  const reducerInput = [
    `Video duration: ${durationSeconds} seconds`,
    `Number of chunks: ${chunks.length}`,
    '',
    'Per-chunk analyses:',
    ...chunkResults.map((r, i) =>
      `--- Chunk ${i + 1} [${r.startSec.toFixed(1)}s – ${r.endSec.toFixed(1)}s] ---\n` +
      `typeVotes: ${JSON.stringify(r.typeVotes)}\n` +
      `summary: ${r.summary}\n` +
      `chapters: ${JSON.stringify(r.chapters)}`
    ),
    '',
    '--- Merged candidate chapters (deduped near boundaries) ---',
    JSON.stringify(allCandidates, null, 2),
  ].join('\n');

  let reduced;
  try {
    reduced = await callGptJson(reducerSystemPrompt, reducerInput);
  } catch (err) {
    throw new Error(`GPT classifyAndSummarize reduce failed: ${err.message}`);
  }
  if (!reduced || typeof reduced !== 'object') {
    // Fall back to mechanical merge — pick the type with the highest summed vote
    // and concatenate chunk summaries.
    const votes = {};
    for (const r of chunkResults) {
      for (const [k, v] of Object.entries(r.typeVotes || {})) {
        votes[k] = (votes[k] || 0) + (Number(v) || 0);
      }
    }
    const type = Object.entries(votes).sort((a, b) => b[1] - a[1])[0]?.[0] || 'other';
    return {
      type,
      title: transcript.title || 'Untitled',
      summary: chunkResults.map(r => r.summary).filter(Boolean).join(' '),
      chapters: allCandidates,
    };
  }

  const type = typeof reduced.type === 'string' ? reduced.type : 'other';
  const title = typeof reduced.title === 'string' && reduced.title.trim() ? reduced.title.trim() : (transcript.title || 'Untitled');
  const summary = typeof reduced.summary === 'string' ? reduced.summary.trim() : '';
  const chapters = sanitizeChapters(reduced.chapters, durationSeconds);

  return { type, title, summary, chapters };
}

/**
 * First-pass GPT analysis that classifies the recording type and produces
 * universal artifacts (title, summary, chapters). Works for ANY recording —
 * not just bug reports. Subsequent type-specific extractors (action items,
 * key concepts) are called based on the returned `type`.
 *
 * For recordings longer than CHUNKING_THRESHOLD_SEC, transparently routes
 * through a map-reduce path: split into 8-min overlapping chunks, analyze
 * each in parallel, merge the results.
 *
 * @param {{text: string, words?: Array}} transcript
 * @param {number|null} durationSeconds
 * @param {Array|null} urlEvents
 * @param {Array|null} consoleEvents
 * @param {Array|null} actionEvents
 * @returns {Promise<{type: string, title: string, summary: string, chapters: Array<{time: number, title: string}>}>}
 */
export async function classifyAndSummarize(transcript, durationSeconds = null, urlEvents = null, consoleEvents = null, actionEvents = null) {
  const useChunking = durationSeconds && durationSeconds > CHUNKING_THRESHOLD_SEC
    && Array.isArray(transcript?.words) && transcript.words.length > 0;
  try {
    if (useChunking) {
      return await classifyAndSummarizeChunked(transcript, durationSeconds, urlEvents, consoleEvents, actionEvents);
    }
    return await classifyAndSummarizeSinglePass(transcript, durationSeconds, urlEvents, consoleEvents, actionEvents);
  } catch (err) {
    throw new Error(`GPT classifyAndSummarize failed: ${err.message}`);
  }
}

async function extractActionItemsSinglePass(transcript, chapters) {
  const systemPrompt = loadPrompt('analyze-meeting.txt');
  const wordsWithTime = formatTimestampedWords(transcript.words);

  let userMessage = `Transcription:\n\n${transcript.text}\n\nWord-level timestamps:\n${wordsWithTime}`;
  userMessage += formatChapters(chapters);

  const result = await callGptJson(systemPrompt, userMessage);
  if (!result || typeof result !== 'object') {
    return { actionItems: [], decisions: [], openQuestions: [] };
  }
  return {
    actionItems: Array.isArray(result.actionItems) ? result.actionItems : [],
    decisions: Array.isArray(result.decisions) ? result.decisions : [],
    openQuestions: Array.isArray(result.openQuestions) ? result.openQuestions : [],
  };
}

/**
 * Chunked extractActionItems: the existing meeting prompt already operates on
 * a "section of transcript", so we run it on each chunk in parallel and merge
 * the lists programmatically (dedupeByTime — overlap regions emit the same
 * item with a near-identical timestamp from two chunks).
 */
async function extractActionItemsChunked(transcript, chapters, durationSeconds) {
  const chunks = splitTranscriptIntoChunks(transcript, durationSeconds);
  const systemPrompt = loadPrompt('analyze-meeting.txt');

  const chunkResults = await Promise.all(chunks.map(async (chunk) => {
    const wordsWithTime = formatTimestampedWords(chunk.words);
    let userMessage = `Transcription (chunk ${chunk.startSec.toFixed(1)}s – ${chunk.endSec.toFixed(1)}s of ${durationSeconds.toFixed(1)}s):\n\n${chunk.text}\n\nWord-level timestamps (absolute):\n${wordsWithTime}`;
    // Pass only chapters that fall within this chunk's time range so the
    // model has local navigation context without distraction from far-away topics.
    const chunkChapters = (chapters || []).filter(c => {
      const t = Number(c.time) || 0;
      return t >= chunk.startSec && t < chunk.endSec;
    });
    userMessage += formatChapters(chunkChapters);

    try {
      const res = await callGptJson(systemPrompt, userMessage);
      return {
        actionItems: (res && Array.isArray(res.actionItems)) ? res.actionItems : [],
        decisions:    (res && Array.isArray(res.decisions))    ? res.decisions    : [],
        openQuestions:(res && Array.isArray(res.openQuestions))? res.openQuestions: [],
      };
    } catch {
      return { actionItems: [], decisions: [], openQuestions: [] };
    }
  }));

  const flat = {
    actionItems:   chunkResults.flatMap(r => r.actionItems),
    decisions:     chunkResults.flatMap(r => r.decisions),
    openQuestions: chunkResults.flatMap(r => r.openQuestions),
  };

  return {
    actionItems:   dedupeByTime(flat.actionItems,   30),
    decisions:     dedupeByTime(flat.decisions,     30),
    openQuestions: dedupeByTime(flat.openQuestions, 30),
  };
}

/**
 * Extract action items, decisions and open questions from a meeting/call recording.
 * Should only be called when classifyAndSummarize returned type='meeting'.
 *
 * @param {{text: string, words?: Array}} transcript
 * @param {Array<{time: number, title: string}>} chapters
 * @param {number|null} durationSeconds
 * @returns {Promise<{actionItems: Array, decisions: Array, openQuestions: Array}>}
 */
export async function extractActionItems(transcript, chapters = [], durationSeconds = null) {
  const useChunking = durationSeconds && durationSeconds > CHUNKING_THRESHOLD_SEC
    && Array.isArray(transcript?.words) && transcript.words.length > 0;
  try {
    if (useChunking) {
      return await extractActionItemsChunked(transcript, chapters, durationSeconds);
    }
    return await extractActionItemsSinglePass(transcript, chapters);
  } catch (err) {
    throw new Error(`GPT extractActionItems failed: ${err.message}`);
  }
}

async function extractKeyConceptsSinglePass(transcript, chapters, urlEvents, actionEvents) {
  const systemPrompt = loadPrompt('analyze-lesson.txt');
  const wordsWithTime = formatTimestampedWords(transcript.words);

  let userMessage = `Transcription:\n\n${transcript.text}\n\nWord-level timestamps:\n${wordsWithTime}`;
  userMessage += formatChapters(chapters);
  userMessage += formatUrlEvents(urlEvents);
  userMessage += formatActionEvents(actionEvents);

  const result = await callGptJson(systemPrompt, userMessage);
  if (!result || typeof result !== 'object') {
    return { learningGoals: [], keyConcepts: [], practicalSteps: [], prerequisites: [] };
  }
  return {
    learningGoals:  Array.isArray(result.learningGoals)  ? result.learningGoals  : [],
    keyConcepts:    Array.isArray(result.keyConcepts)    ? result.keyConcepts    : [],
    practicalSteps: Array.isArray(result.practicalSteps) ? result.practicalSteps : [],
    prerequisites:  Array.isArray(result.prerequisites)  ? result.prerequisites  : [],
  };
}

// Plain-string dedup for the goal/prerequisite arrays — case-insensitive, keeps
// the first occurrence. Used because learningGoals/prerequisites are strings
// without timestamps so dedupeByTime doesn't apply.
function dedupeStrings(arr) {
  if (!Array.isArray(arr)) return [];
  const seen = new Set();
  const out = [];
  for (const s of arr) {
    if (typeof s !== 'string') continue;
    const key = s.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(s.trim());
  }
  return out;
}

async function extractKeyConceptsChunked(transcript, chapters, urlEvents, actionEvents, durationSeconds) {
  const chunks = splitTranscriptIntoChunks(transcript, durationSeconds, { urlEvents, actionEvents });
  const systemPrompt = loadPrompt('analyze-lesson.txt');

  const chunkResults = await Promise.all(chunks.map(async (chunk) => {
    const wordsWithTime = formatTimestampedWords(chunk.words);
    let userMessage = `Transcription (chunk ${chunk.startSec.toFixed(1)}s – ${chunk.endSec.toFixed(1)}s of ${durationSeconds.toFixed(1)}s):\n\n${chunk.text}\n\nWord-level timestamps (absolute):\n${wordsWithTime}`;
    const chunkChapters = (chapters || []).filter(c => {
      const t = Number(c.time) || 0;
      return t >= chunk.startSec && t < chunk.endSec;
    });
    userMessage += formatChapters(chunkChapters);
    userMessage += formatUrlEvents(chunk.urlEvents);
    userMessage += formatActionEvents(chunk.actionEvents);

    try {
      const res = await callGptJson(systemPrompt, userMessage);
      return {
        learningGoals:  (res && Array.isArray(res.learningGoals))  ? res.learningGoals  : [],
        keyConcepts:    (res && Array.isArray(res.keyConcepts))    ? res.keyConcepts    : [],
        practicalSteps: (res && Array.isArray(res.practicalSteps)) ? res.practicalSteps : [],
        prerequisites:  (res && Array.isArray(res.prerequisites))  ? res.prerequisites  : [],
      };
    } catch {
      return { learningGoals: [], keyConcepts: [], practicalSteps: [], prerequisites: [] };
    }
  }));

  return {
    learningGoals:  dedupeStrings(chunkResults.flatMap(r => r.learningGoals)).slice(0, 5),
    keyConcepts:    dedupeByTime(chunkResults.flatMap(r => r.keyConcepts),    30),
    practicalSteps: dedupeByTime(chunkResults.flatMap(r => r.practicalSteps), 15),
    prerequisites:  dedupeStrings(chunkResults.flatMap(r => r.prerequisites)).slice(0, 3),
  };
}

const VISION_SELECT_PROMPT =
  'These are sequential frames from a screen recording. Each frame is preceded by its label [frame t=<sec>s]. ' +
  'The user recorded their screen and narrates what they are doing. ' +
  'Pick the KEY frames: every distinct, meaningful screen state (a different page/card/modal/important step — ' +
  'before an action, the action itself, the result). ' +
  'DISCARD: blank screens, loading spinners, and duplicates of the same state. ' +
  'There is no fixed limit — return as many as there are genuinely distinct states (a long video has more). ' +
  'For each chosen frame return the EXACT timecode from its [frame t=Xs] label, a short title (3-6 words), and ' +
  'detail (1-2 sentences describing what is CONCRETELY visible — names, IDs, statuses, elements; not vague). ' +
  'Write title/detail in the same language as the on-screen text or narration. ' +
  'Return strict JSON: {"frames":[{"time":<sec>,"title":"<title>","detail":"<what is visible>"}]}';

/**
 * Vision-based key-frame selection: the model SEES candidate frames and picks the
 * distinct meaningful screen states (+ captions), instead of guessing timestamps
 * from transcript text. Processed in windows so it scales to any video length.
 * See docs/frame-selection-vision.md.
 *
 * @param {Array<{time: number, path: string}>} candidates - dense candidate frames (from extractCandidates)
 * @param {string} transcriptText - plain transcript for context (truncated)
 * @param {{model: string, reasoning: string, windowSize: number}} opts
 * @returns {Promise<Array<{time: number, description: string, detail: string}>>} - empty on failure (caller falls back)
 */
export async function selectFramesVision(candidates, transcriptText, opts) {
  if (!candidates || candidates.length === 0) return [];
  const { model, reasoning, windowSize } = opts;
  const isReasoningModel = /gpt-5/.test(model) || /^o\d/.test(model);
  const ctx = (transcriptText || '').slice(0, 4000);

  const picks = [];
  for (let start = 0; start < candidates.length; start += windowSize) {
    const window = candidates.slice(start, start + windowSize);
    const content = [{ type: 'text', text:
      VISION_SELECT_PROMPT + (ctx ? `\n\n--- Narration transcript (context) ---\n${ctx}` : '') }];
    for (const c of window) {
      let b64;
      try { b64 = fs.readFileSync(c.path).toString('base64'); }
      catch { continue; }
      content.push({ type: 'text', text: `\n[frame t=${c.time}s]` });
      content.push({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}`, detail: 'high' } });
    }
    const body = {
      model,
      messages: [{ role: 'user', content }],
      response_format: { type: 'json_object' },
    };
    if (isReasoningModel) body.reasoning_effort = reasoning;
    else body.temperature = 0.2;

    let res;
    try {
      res = await fetch(config.gpt.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.gpt.apiKey}` },
        body: JSON.stringify(body),
      });
    } catch (err) {
      console.error(`[selectFramesVision] request failed (window ${start}): ${err.message}`);
      continue;
    }
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      console.error(`[selectFramesVision] ${model} error ${res.status} (window ${start}): ${t.slice(0, 300)}`);
      continue;
    }
    let parsed;
    try {
      const data = await res.json();
      parsed = JSON.parse(data.choices?.[0]?.message?.content || '{}');
    } catch (err) {
      console.error(`[selectFramesVision] bad JSON (window ${start}): ${err.message}`);
      continue;
    }
    for (const f of (parsed.frames || [])) {
      const time = Number(f.time);
      if (isNaN(time)) continue;
      const detail = String(f.detail || f.caption || '').slice(0, 400);
      const description = String(f.title || '').slice(0, 120) || detail.slice(0, 80);
      picks.push({ time, description, detail });
    }
  }
  picks.sort((a, b) => a.time - b.time);
  return picks;
}

/**
 * Extract learning goals, key concepts and practical steps from a tutorial/lesson.
 * Should only be called when classifyAndSummarize returned type in
 * (tutorial, walkthrough, lesson).
 *
 * @param {{text: string, words?: Array}} transcript
 * @param {Array<{time: number, title: string}>} chapters
 * @param {Array|null} urlEvents
 * @param {Array|null} actionEvents
 * @param {number|null} durationSeconds
 * @returns {Promise<{learningGoals: Array, keyConcepts: Array, practicalSteps: Array, prerequisites: Array}>}
 */
export async function extractKeyConcepts(transcript, chapters = [], urlEvents = null, actionEvents = null, durationSeconds = null) {
  const useChunking = durationSeconds && durationSeconds > CHUNKING_THRESHOLD_SEC
    && Array.isArray(transcript?.words) && transcript.words.length > 0;
  try {
    if (useChunking) {
      return await extractKeyConceptsChunked(transcript, chapters, urlEvents, actionEvents, durationSeconds);
    }
    return await extractKeyConceptsSinglePass(transcript, chapters, urlEvents, actionEvents);
  } catch (err) {
    throw new Error(`GPT extractKeyConcepts failed: ${err.message}`);
  }
}
