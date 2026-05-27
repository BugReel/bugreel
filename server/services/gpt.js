import { config } from '../config.js';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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

/**
 * First-pass GPT analysis that classifies the recording type and produces
 * universal artifacts (title, summary, chapters). Works for ANY recording —
 * not just bug reports. Subsequent type-specific extractors (action items,
 * key concepts) are called based on the returned `type`.
 *
 * @param {{text: string, words?: Array}} transcript
 * @param {number|null} durationSeconds
 * @param {Array|null} urlEvents
 * @param {Array|null} consoleEvents
 * @param {Array|null} actionEvents
 * @returns {Promise<{type: string, title: string, summary: string, chapters: Array<{time: number, title: string}>}>}
 */
export async function classifyAndSummarize(transcript, durationSeconds = null, urlEvents = null, consoleEvents = null, actionEvents = null) {
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

  let result;
  try {
    result = await callGptJson(systemPrompt, userMessage);
  } catch (err) {
    throw new Error(`GPT classifyAndSummarize failed: ${err.message}`);
  }

  if (!result || typeof result !== 'object') {
    return { type: 'other', title: transcript.title || 'Untitled', summary: '', chapters: [] };
  }

  const type = typeof result.type === 'string' ? result.type : 'other';
  const title = typeof result.title === 'string' && result.title.trim() ? result.title.trim() : (transcript.title || 'Untitled');
  const summary = typeof result.summary === 'string' ? result.summary.trim() : '';
  let chapters = Array.isArray(result.chapters) ? result.chapters : [];

  // Clamp chapter times to the video duration and ensure strictly increasing order.
  if (durationSeconds != null && durationSeconds > 0) {
    const maxTime = Math.max(0, durationSeconds - 1);
    chapters = chapters
      .filter(c => c && typeof c.title === 'string')
      .map(c => ({
        time: Math.max(0, Math.min(Number(c.time) || 0, maxTime)),
        title: String(c.title).trim(),
      }))
      .sort((a, b) => a.time - b.time);
  }

  return { type, title, summary, chapters };
}

/**
 * Extract action items, decisions and open questions from a meeting/call recording.
 * Should only be called when classifyAndSummarize returned type='meeting'.
 *
 * @param {{text: string, words?: Array}} transcript
 * @param {Array<{time: number, title: string}>} chapters
 * @returns {Promise<{actionItems: Array, decisions: Array, openQuestions: Array}>}
 */
export async function extractActionItems(transcript, chapters = []) {
  const systemPrompt = loadPrompt('analyze-meeting.txt');
  const wordsWithTime = formatTimestampedWords(transcript.words);

  let userMessage = `Transcription:\n\n${transcript.text}\n\nWord-level timestamps:\n${wordsWithTime}`;
  userMessage += formatChapters(chapters);

  let result;
  try {
    result = await callGptJson(systemPrompt, userMessage);
  } catch (err) {
    throw new Error(`GPT extractActionItems failed: ${err.message}`);
  }

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
 * Extract learning goals, key concepts and practical steps from a tutorial/lesson.
 * Should only be called when classifyAndSummarize returned type in
 * (tutorial, walkthrough, lesson).
 *
 * @param {{text: string, words?: Array}} transcript
 * @param {Array<{time: number, title: string}>} chapters
 * @param {Array|null} urlEvents
 * @param {Array|null} actionEvents
 * @returns {Promise<{learningGoals: Array, keyConcepts: Array, practicalSteps: Array, prerequisites: Array}>}
 */
export async function extractKeyConcepts(transcript, chapters = [], urlEvents = null, actionEvents = null) {
  const systemPrompt = loadPrompt('analyze-lesson.txt');
  const wordsWithTime = formatTimestampedWords(transcript.words);

  let userMessage = `Transcription:\n\n${transcript.text}\n\nWord-level timestamps:\n${wordsWithTime}`;
  userMessage += formatChapters(chapters);
  userMessage += formatUrlEvents(urlEvents);
  userMessage += formatActionEvents(actionEvents);

  let result;
  try {
    result = await callGptJson(systemPrompt, userMessage);
  } catch (err) {
    throw new Error(`GPT extractKeyConcepts failed: ${err.message}`);
  }

  if (!result || typeof result !== 'object') {
    return { learningGoals: [], keyConcepts: [], practicalSteps: [], prerequisites: [] };
  }

  return {
    learningGoals: Array.isArray(result.learningGoals) ? result.learningGoals : [],
    keyConcepts: Array.isArray(result.keyConcepts) ? result.keyConcepts : [],
    practicalSteps: Array.isArray(result.practicalSteps) ? result.practicalSteps : [],
    prerequisites: Array.isArray(result.prerequisites) ? result.prerequisites : [],
  };
}
