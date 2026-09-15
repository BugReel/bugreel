#!/usr/bin/env node
// Re-run AI classify+summarize for recordings whose transcript exists but whose
// AI result is missing or a silent fallback ("Untitled" / empty summary).
// Does NOT re-transcribe or re-compress — only ai_type/ai_title/ai_summary/
// ai_chapters_json are rewritten. Idempotent: rows with a real summary are skipped.
// Use after an AI provider outage (e.g. a revoked API key).
//
// Run only AFTER the GPT key is fixed (aborts on the first auth/quota error).
//
// Usage:
//   node scripts/backfill-ai-summary.mjs --dry-run              # list candidates
//   node scripts/backfill-ai-summary.mjs --since 2026-08-22     # backfill window
//   node scripts/backfill-ai-summary.mjs REC-2026-0481          # one recording
//   node scripts/backfill-ai-summary.mjs --since 2026-08-22 --limit 20

import path from 'path';
import Database from 'better-sqlite3';
import { config } from '../server/config.js';
import { classifyAndSummarize } from '../server/services/gpt.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const argVal = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const since = argVal('--since') || '2026-08-22';
const limit = parseInt(argVal('--limit') || '0', 10) || 0;
const onlyId = args.find((a, i) => !a.startsWith('--') && !['--since', '--limit'].includes(args[i - 1])) || null;
const MIN_TEXT = 300; // shorter transcripts are mostly silence/hallucination — not worth a call

// DATA_DIR differs between pm2 env and bugreel/.env — open only an existing DB, never create an empty one.
const dbPath = path.resolve(config.dataDir, 'tracker.db');
const db = new Database(dbPath, { readonly: dryRun, fileMustExist: true });

const baseWhere = `transcript_json IS NOT NULL
  AND length(json_extract(transcript_json,'$.text')) >= ${MIN_TEXT}
  AND (COALESCE(ai_summary,'') = '' OR ai_title = 'Untitled')`;
let rows = onlyId
  ? db.prepare(`SELECT id, duration_seconds, transcript_json, url_events_json, console_events_json, action_events_json FROM recordings WHERE id = ?`).all(onlyId)
  : db.prepare(`SELECT id, duration_seconds, transcript_json, url_events_json, console_events_json, action_events_json FROM recordings WHERE created_at >= ? AND ${baseWhere} ORDER BY created_at`).all(since);
if (limit) rows = rows.slice(0, limit);

console.log(`[backfill-ai-summary] db=${dbPath} candidates=${rows.length} since=${onlyId ? '-' : since} dryRun=${dryRun}`);
if (dryRun) {
  for (const r of rows) console.log(`  ${r.id} dur=${r.duration_seconds}s`);
  process.exit(0);
}

const parse = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
const upd = db.prepare('UPDATE recordings SET ai_type = ?, ai_title = ?, ai_summary = ?, ai_chapters_json = ? WHERE id = ?');

let ok = 0, failed = 0;
for (const r of rows) {
  const transcript = parse(r.transcript_json);
  if (!transcript) { failed++; continue; }
  try {
    const c = await classifyAndSummarize(transcript, r.duration_seconds,
      parse(r.url_events_json), parse(r.console_events_json), parse(r.action_events_json));
    if (!c.summary) { console.warn(`  ${r.id}: model returned empty summary, left as is`); failed++; continue; }
    upd.run(c.type, c.title, c.summary, JSON.stringify(c.chapters || []), r.id);
    console.log(`  ${r.id}: ${c.type}, ${(c.chapters || []).length} chapters`);
    ok++;
  } catch (err) {
    console.error(`  ${r.id}: FAIL ${err.message}`);
    failed++;
    // A dead key fails every row the same way — stop instead of burning the list.
    if (/invalid_api_key|insufficient_quota|401/.test(err.message)) { console.error('aborting: GPT auth/quota error'); break; }
  }
}
console.log(`[backfill-ai-summary] ok=${ok} failed=${failed}`);
process.exit(failed && !ok ? 1 : 0);
