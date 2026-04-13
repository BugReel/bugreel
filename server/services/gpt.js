import { config } from '../config.js';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Analyze a transcript using GPT to produce a structured bug/feature card.
 * @param {{ text: string, title?: string, words?: Array<{word: string, start: number, end: number}> }} transcript
 * @param {Array<{time: number, url: string, title?: string, type?: string}>|null} [urlEvents] - URL navigation events
 * @param {Array<{time: number, type: string, message: string, source?: string}>|null} [consoleEvents] - Console errors
 * @returns {{ type: string, title: string, steps: string[], expected?: string, actual?: string, context?: string, keyFrames: Array<{time: number, description: string}>, affected_urls?: string[], error_context?: string }}
 */
export async function analyzeTranscript(transcript, urlEvents = null, consoleEvents = null, actionEvents = null, durationSeconds = null) {
  const systemPrompt = fs.readFileSync(
    path.join(__dirname, '..', 'prompts', 'analyze-transcript.txt'),
    'utf-8'
  );

  // Format words with timestamps: [0.0s] word [0.5s] word2 ...
  const wordsWithTime = (transcript.words || [])
    .map(w => `[${w.start.toFixed(1)}s] ${w.word}`)
    .join(' ');

  let userMessage = '';
  if (durationSeconds != null && durationSeconds > 0) {
    userMessage += `Video duration: ${durationSeconds} seconds\n\n`;
  }
  userMessage += `Video transcript:\n\n${transcript.text}\n\nWith timestamps:\n${wordsWithTime}`;

  // Append URL events if present
  if (urlEvents && urlEvents.length > 0) {
    const urlLines = urlEvents.map(e => {
      const ts = (e.ts ?? e.time ?? 0);
      const title = e.title ? ` (${e.title})` : '';
      const type = e.type ? ` [${e.type}]` : '';
      return `[${Number(ts).toFixed(1)}s] ${e.url}${title}${type}`;
    }).join('\n');
    userMessage += `\n\n--- URL Events ---\n${urlLines}`;
  }

  // Append console errors if present
  if (consoleEvents && consoleEvents.length > 0) {
    const errorLines = consoleEvents.map(e => {
      const ts = (e.ts ?? e.time ?? 0);
      const level = (e.level ?? e.type ?? 'error').toUpperCase();
      const text = e.text ?? e.message ?? '';
      const source = e.source ? ` (${e.source})` : '';
      return `[${Number(ts).toFixed(1)}s] ${level}: ${text}${source}`;
    }).join('\n');
    userMessage += `\n\n--- Console Errors ---\n${errorLines}`;
  }

  // Append user action events if present (clicks, modals, selections)
  if (actionEvents && actionEvents.length > 0) {
    const ACTION_LABELS = { click: 'click', modal_open: 'modal open', modal_close: 'modal close', form_submit: 'form submit', text_select: 'select' };
    const actionLines = actionEvents.map(e => {
      const ts = Number(e.ts ?? 0).toFixed(1);
      const type = ACTION_LABELS[e.eventType] || e.eventType;
      const label = (e.ariaLabel || e.text || '').slice(0, 40);
      const tag = e.tag || '';
      const path = e.path ? e.path.split('>').pop().trim() : '';
      return `[${ts}s] ${type} <${tag}> "${label}" ${path}`;
    }).join('\n');
    userMessage += `\n\n--- User Actions (UI events, not user speech) ---\n${actionLines}`;
  }

  const callGpt = async (extraNudge) => {
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
  };

  let analysis;
  try {
    analysis = await callGpt();
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
      const retry = await callGpt(
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
