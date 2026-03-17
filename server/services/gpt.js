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
export async function analyzeTranscript(transcript, urlEvents = null, consoleEvents = null, actionEvents = null) {
  const systemPrompt = fs.readFileSync(
    path.join(__dirname, '..', 'prompts', 'analyze-transcript.txt'),
    'utf-8'
  );

  // Format words with timestamps: [0.0s] word [0.5s] word2 ...
  const wordsWithTime = (transcript.words || [])
    .map(w => `[${w.start.toFixed(1)}s] ${w.word}`)
    .join(' ');

  let userMessage = `Video transcript:\n\n${transcript.text}\n\nWith timestamps:\n${wordsWithTime}`;

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

  let res;
  try {
    res = await fetch(config.gpt.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.gpt.apiKey}`,
      },
      body: JSON.stringify({
        model: config.gpt.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        response_format: { type: 'json_object' },
      }),
    });
  } catch (err) {
    throw new Error(`GPT request failed: ${err.message}`);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GPT error ${res.status}: ${body}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;

  try {
    return JSON.parse(content);
  } catch {
    // Fallback if GPT returned non-JSON
    return {
      type: 'bug',
      title: transcript.title || 'Untitled',
      steps: [],
      keyFrames: [],
    };
  }
}
