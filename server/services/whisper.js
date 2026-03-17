import { config } from '../config.js';
import fs from 'fs';
import FormData from 'form-data';
import fetch from 'node-fetch';

/**
 * Send audio file to Whisper transcription service.
 * @param {string} audioPath - path to MP3 file
 * @returns {{ title: string, text: string, words: Array<{word: string, start: number, end: number}>, segments: Array }} transcription result
 */
export async function transcribe(audioPath) {
  const form = new FormData();
  form.append('file', fs.createReadStream(audioPath), {
    filename: 'audio.mp3',
    contentType: 'audio/mpeg',
  });

  let res;
  try {
    res = await fetch(config.whisper.url, {
      method: 'POST',
      body: form,
      headers: form.getHeaders(),
      timeout: 300000, // 5 minutes
    });
  } catch (err) {
    throw new Error(`Whisper request failed: ${err.message}`);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Whisper error ${res.status}: ${body}`);
  }

  const data = await res.json();

  // Whisper may return an array [{text, words, segments}] — unwrap it
  if (Array.isArray(data)) {
    return data[0] || { text: '', words: [], segments: [] };
  }
  return data;
}
