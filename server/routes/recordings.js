import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { config } from '../config.js';
import { getDB } from '../db.js';
import { getQueueStatus } from '../services/pipeline.js';
import { getTrackerConfig } from './settings.js';

/**
 * Recursively calculate total size of a directory in bytes.
 */
function getDirSize(dirPath) {
  let total = 0;
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        total += getDirSize(fullPath);
      } else {
        try { total += fs.statSync(fullPath).size; } catch {}
      }
    }
  } catch {}
  return total;
}

const router = Router();

// Queue status (for monitoring)
router.get('/status', (req, res) => {
  const db = getDB();
  const total = db.prepare('SELECT COUNT(*) as c FROM recordings').get().c;
  const processing = db.prepare("SELECT COUNT(*) as c FROM recordings WHERE status NOT IN ('complete', 'error')").get().c;
  const diskUsageBytes = getDirSize(config.dataDir);
  const tracker = getTrackerConfig();
  res.json({
    queue: getQueueStatus(),
    recordings: { total, processing },
    storage: { diskUsageBytes, diskUsageMB: Math.round(diskUsageBytes / 1048576 * 10) / 10 },
    tracker: {
      type: tracker.type,
      connected: tracker.connected,
    },
  });
});

// Cleanup: delete audio.mp3 for all complete recordings
router.post('/cleanup', (req, res) => {
  const db = getDB();
  const complete = db.prepare("SELECT id FROM recordings WHERE status = 'complete'").all();

  let deleted = 0;
  let freedBytes = 0;

  for (const { id } of complete) {
    const audioPath = path.join(config.dataDir, id, 'audio.mp3');
    try {
      const stat = fs.statSync(audioPath);
      fs.unlinkSync(audioPath);
      freedBytes += stat.size;
      deleted++;
    } catch {}
  }

  res.json({
    deleted,
    freedBytes,
    freedMB: Math.round(freedBytes / 1048576 * 10) / 10
  });
});

// List recordings with optional filters and pagination
router.get('/recordings', (req, res) => {
  const db = getDB();
  const { status, author, youtrack, limit = 50, offset = 0 } = req.query;

  let where = '';
  const conditions = [];
  const params = [];

  if (status) {
    conditions.push('r.status = ?');
    params.push(status);
  }
  if (author) {
    conditions.push('r.author = ?');
    params.push(author);
  }
  if (youtrack === 'pending') {
    conditions.push("r.status = 'complete'");
    conditions.push("(c.youtrack_issue_id IS NULL OR c.youtrack_issue_id = '')");
  }
  if (conditions.length) {
    where = ' WHERE ' + conditions.join(' AND ');
  }

  const countRow = db.prepare(`SELECT COUNT(*) as total FROM recordings r${where}`).get(...params);

  const rows = db.prepare(
    `SELECT r.*,
      (SELECT f.filename FROM frames f WHERE f.recording_id = r.id ORDER BY f.time_seconds LIMIT 1) as first_frame,
      (SELECT COUNT(*) FROM video_comments vc WHERE vc.recording_id = r.id) as comment_count,
      (SELECT COUNT(*) FROM views v WHERE v.recording_id = r.id) as view_count,
      c.title as card_title,
      c.summary as card_summary,
      c.id as card_id,
      c.cs_total,
      c.cs_category,
      c.youtrack_issue_id as card_youtrack_id
    FROM recordings r
    LEFT JOIN cards c ON c.recording_id = r.id${where}
    ORDER BY r.created_at DESC LIMIT ? OFFSET ?`
  ).all(...params, parseInt(limit), parseInt(offset));

  // Add has_password flag, remove password_hash from response
  for (const row of rows) {
    row.has_password = !!row.password_hash;
    delete row.password_hash;
  }

  res.json({ recordings: rows, total: countRow.total });
});

// Public lookup by share_token (no auth required — used by report/embed pages)
router.get('/recordings/by-token/:token', (req, res) => {
  const db = getDB();
  const recording = db.prepare('SELECT * FROM recordings WHERE share_token = ?').get(req.params.token);
  if (!recording) return res.status(404).json({ error: 'Not found' });

  // Add has_password flag, remove password_hash from response
  recording.has_password = !!recording.password_hash;
  delete recording.password_hash;

  // Parse JSON fields
  if (recording.transcript_json) {
    try { recording.transcript = JSON.parse(recording.transcript_json); } catch { recording.transcript = null; }
  }
  if (recording.analysis_json) {
    try { recording.analysis = JSON.parse(recording.analysis_json); } catch { recording.analysis = null; }
  }
  if (recording.url_events_json) {
    try { recording.url_events = JSON.parse(recording.url_events_json); } catch { recording.url_events = null; }
  }
  if (recording.metadata_json) {
    try { recording.metadata = JSON.parse(recording.metadata_json); } catch { recording.metadata = null; }
  }
  if (recording.console_events_json) {
    try { recording.console_events = JSON.parse(recording.console_events_json); } catch { recording.console_events = null; }
  }
  if (recording.action_events_json) {
    try { recording.action_events = JSON.parse(recording.action_events_json); } catch { recording.action_events = null; }
  }

  const frames = db.prepare(
    'SELECT * FROM frames WHERE recording_id = ? ORDER BY time_seconds'
  ).all(recording.id);

  const card = db.prepare(
    'SELECT * FROM cards WHERE recording_id = ?'
  ).get(recording.id);

  const comments = card
    ? db.prepare('SELECT * FROM comments WHERE card_id = ? ORDER BY created_at').all(card.id)
    : [];

  const video_comments = db.prepare(
    'SELECT id, recording_id, author_name, text, timecode_seconds, created_at FROM video_comments WHERE recording_id = ? ORDER BY created_at ASC'
  ).all(recording.id);

  res.json({ recording, frames, card, comments, video_comments });
});

// Single recording with frames and card, JSON fields parsed
router.get('/recordings/:id', (req, res) => {
  const db = getDB();
  // Try by ID first, then by share_token as fallback
  let recording = db.prepare('SELECT * FROM recordings WHERE id = ?').get(req.params.id);
  if (!recording) {
    recording = db.prepare('SELECT * FROM recordings WHERE share_token = ?').get(req.params.id);
  }
  if (!recording) return res.status(404).json({ error: 'Not found' });

  // Add has_password flag, remove password_hash from response
  recording.has_password = !!recording.password_hash;
  delete recording.password_hash;

  // Parse JSON fields
  if (recording.transcript_json) {
    try { recording.transcript = JSON.parse(recording.transcript_json); } catch { recording.transcript = null; }
  }
  if (recording.analysis_json) {
    try { recording.analysis = JSON.parse(recording.analysis_json); } catch { recording.analysis = null; }
  }
  if (recording.url_events_json) {
    try { recording.url_events = JSON.parse(recording.url_events_json); } catch { recording.url_events = null; }
  }
  if (recording.metadata_json) {
    try { recording.metadata = JSON.parse(recording.metadata_json); } catch { recording.metadata = null; }
  }
  if (recording.console_events_json) {
    try { recording.console_events = JSON.parse(recording.console_events_json); } catch { recording.console_events = null; }
  }
  if (recording.action_events_json) {
    try { recording.action_events = JSON.parse(recording.action_events_json); } catch { recording.action_events = null; }
  }

  const frames = db.prepare(
    'SELECT * FROM frames WHERE recording_id = ? ORDER BY time_seconds'
  ).all(recording.id);

  const card = db.prepare(
    'SELECT * FROM cards WHERE recording_id = ?'
  ).get(recording.id);

  const comments = card
    ? db.prepare('SELECT * FROM comments WHERE card_id = ? ORDER BY created_at').all(card.id)
    : [];

  const video_comments = db.prepare(
    'SELECT id, recording_id, author_name, text, timecode_seconds, created_at FROM video_comments WHERE recording_id = ? ORDER BY created_at ASC'
  ).all(recording.id);

  res.json({ recording, frames, card, comments, video_comments });
});

// Update transcript (words array — word-level editing)
router.put('/recordings/:id/transcript', (req, res) => {
  const db = getDB();
  const { words } = req.body;
  if (!Array.isArray(words)) return res.status(400).json({ error: 'words array is required' });

  const recording = db.prepare('SELECT id, transcript_json FROM recordings WHERE id = ?').get(req.params.id);
  if (!recording) return res.status(404).json({ error: 'Recording not found' });

  let transcript = {};
  try { transcript = JSON.parse(recording.transcript_json || '{}'); } catch {}
  transcript.words = words;
  transcript.text = words.map(w => w.word).join(' ');

  db.prepare('UPDATE recordings SET transcript_json = ? WHERE id = ?')
    .run(JSON.stringify(transcript), req.params.id);

  res.json({ ok: true });
});

// Update context data (remove items from url_events, console_events, action_events)
router.put('/recordings/:id/context', (req, res) => {
  const db = getDB();
  const { url_events, console_events, action_events } = req.body;

  const recording = db.prepare('SELECT id FROM recordings WHERE id = ?').get(req.params.id);
  if (!recording) return res.status(404).json({ error: 'Recording not found' });

  const updates = [];
  const params = [];
  if (url_events !== undefined) { updates.push('url_events_json = ?'); params.push(JSON.stringify(url_events)); }
  if (console_events !== undefined) { updates.push('console_events_json = ?'); params.push(JSON.stringify(console_events)); }
  if (action_events !== undefined) { updates.push('action_events_json = ?'); params.push(JSON.stringify(action_events)); }

  if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });

  params.push(req.params.id);
  db.prepare(`UPDATE recordings SET ${updates.join(', ')} WHERE id = ?`).run(...params);

  res.json({ ok: true });
});

// Serve video file (supports both recording ID and share_token)
router.get('/recordings/:id/video', (req, res) => {
  const db = getDB();
  // Resolve share_token to recording ID if needed
  let recId = req.params.id;
  const byId = db.prepare('SELECT id FROM recordings WHERE id = ?').get(recId);
  if (!byId) {
    const byToken = db.prepare('SELECT id FROM recordings WHERE share_token = ?').get(recId);
    if (byToken) recId = byToken.id;
  }

  const filePath = path.join(config.dataDir, recId, 'video.webm');
  res.sendFile(filePath, (err) => {
    if (err && !res.headersSent) {
      res.status(404).json({ error: 'Video not found' });
    }
  });
});

// Serve frame image (supports both recording ID and share_token)
router.get('/recordings/:id/frames/:filename', (req, res) => {
  const db = getDB();
  // Resolve share_token to recording ID if needed
  let recId = req.params.id;
  const byId = db.prepare('SELECT id FROM recordings WHERE id = ?').get(recId);
  if (!byId) {
    const byToken = db.prepare('SELECT id FROM recordings WHERE share_token = ?').get(recId);
    if (byToken) recId = byToken.id;
  }

  const filePath = path.join(config.dataDir, recId, 'frames', req.params.filename);
  res.sendFile(filePath, (err) => {
    if (err && !res.headersSent) {
      res.status(404).json({ error: 'Frame not found' });
    }
  });
});

// Pre-link recording to YouTrack issue (draft, before card exists)
router.post('/recordings/:id/pre-link-youtrack', (req, res) => {
  const db = getDB();
  const { youtrack_issue_id } = req.body;

  if (!youtrack_issue_id) {
    return res.status(400).json({ error: 'youtrack_issue_id required' });
  }

  const recording = db.prepare('SELECT id, status FROM recordings WHERE id = ?').get(req.params.id);
  if (!recording) return res.status(404).json({ error: 'Recording not found' });

  // If card already linked to YouTrack, reject
  const card = db.prepare('SELECT youtrack_issue_id FROM cards WHERE recording_id = ?').get(req.params.id);
  if (card?.youtrack_issue_id) {
    return res.status(409).json({ error: 'Already linked', youtrack_issue_id: card.youtrack_issue_id });
  }

  db.prepare('UPDATE recordings SET pending_youtrack_issue_id = ? WHERE id = ?')
    .run(youtrack_issue_id, req.params.id);

  console.log(`[${req.params.id}] Pre-linked to YouTrack: ${youtrack_issue_id}`);
  res.json({ ok: true, pending_youtrack_issue_id: youtrack_issue_id });
});

// Clear pre-link
router.delete('/recordings/:id/pre-link-youtrack', (req, res) => {
  const db = getDB();
  const recording = db.prepare('SELECT id FROM recordings WHERE id = ?').get(req.params.id);
  if (!recording) return res.status(404).json({ error: 'Recording not found' });

  db.prepare('UPDATE recordings SET pending_youtrack_issue_id = NULL WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

export default router;
