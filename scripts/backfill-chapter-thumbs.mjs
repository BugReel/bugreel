#!/usr/bin/env node
// Backfill per-chapter thumbnails for recordings analyzed before the unified
// moments registry. For each recording whose ai_chapters lack a `thumb`,
// extract one frame per chapter into the frames dir and write the thumb
// filename back into ai_chapters_json. Idempotent — chapters that already
// have a thumb (with an existing file) are skipped.
//
// Usage:
//   node scripts/backfill-chapter-thumbs.mjs            # all recordings
//   node scripts/backfill-chapter-thumbs.mjs REC-XXXX   # one recording
//   node scripts/backfill-chapter-thumbs.mjs --dry-run  # report only

import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';
import { config } from '../server/config.js';
import { extractFrame } from '../server/services/ffmpeg.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const onlyId = args.find(a => !a.startsWith('--')) || null;

const dbPath = path.join(config.dataDir, 'tracker.db');
const db = new Database(dbPath, { readonly: dryRun });

const rows = onlyId
  ? db.prepare('SELECT id, duration_seconds, ai_chapters_json FROM recordings WHERE id = ?').all(onlyId)
  : db.prepare("SELECT id, duration_seconds, ai_chapters_json FROM recordings WHERE ai_chapters_json IS NOT NULL AND ai_chapters_json != '[]'").all();

let touched = 0, skipped = 0, extracted = 0, failed = 0;

for (const rec of rows) {
  let chapters;
  try { chapters = JSON.parse(rec.ai_chapters_json); } catch { continue; }
  if (!Array.isArray(chapters) || chapters.length === 0) { skipped++; continue; }

  const recDir = path.join(config.dataDir, rec.id);
  const videoPath = path.join(recDir, 'video.webm');
  const framesDir = path.join(recDir, 'frames');
  if (!fs.existsSync(videoPath)) { console.warn(`[${rec.id}] no video.webm, skip`); skipped++; continue; }

  const duration = Number(rec.duration_seconds) || 0;
  const maxTime = duration > 0 ? Math.max(duration - 0.1, 0) : Infinity;
  const clampTime = t => Math.min(Math.max(Number(t) || 0, 0), maxTime);

  const needs = chapters.some((c, i) => {
    const has = c.thumb && fs.existsSync(path.join(framesDir, c.thumb));
    return !has;
  });
  if (!needs) { skipped++; continue; }

  if (dryRun) {
    const missing = chapters.filter(c => !(c.thumb && fs.existsSync(path.join(framesDir, c.thumb)))).length;
    console.log(`[${rec.id}] would extract ${missing}/${chapters.length} chapter thumbs`);
    touched++;
    continue;
  }

  fs.mkdirSync(framesDir, { recursive: true });
  const out = chapters.slice(0, 50);
  for (let i = 0; i < out.length; i++) {
    const ch = out[i];
    if (ch.thumb && fs.existsSync(path.join(framesDir, ch.thumb))) continue;
    const t = clampTime(ch.time);
    const filename = `ch_${String(i + 1).padStart(3, '0')}_${t.toFixed(1)}s.jpg`;
    try {
      await extractFrame(videoPath, t, path.join(framesDir, filename));
      out[i] = { ...ch, thumb: filename };
      extracted++;
    } catch (err) {
      console.warn(`[${rec.id}] chapter ${i} thumb failed: ${err.message}`);
      failed++;
    }
  }
  db.prepare('UPDATE recordings SET ai_chapters_json = ? WHERE id = ?').run(JSON.stringify(out), rec.id);
  console.log(`[${rec.id}] ${out.filter(c => c.thumb).length}/${out.length} chapters have thumbs`);
  touched++;
}

console.log(`\nDone. recordings touched=${touched}, skipped=${skipped}, frames extracted=${extracted}, failed=${failed}`);
db.close();
