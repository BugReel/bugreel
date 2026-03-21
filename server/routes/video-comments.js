import { Router } from 'express';
import { getDB } from '../db.js';

const router = Router();

/**
 * In-memory rate limiter: max 5 comments per IP per minute
 */
const rateLimitMap = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const windowMs = 60 * 1000;
  const maxRequests = 5;

  if (!rateLimitMap.has(ip)) {
    rateLimitMap.set(ip, []);
  }

  const timestamps = rateLimitMap.get(ip).filter(ts => now - ts < windowMs);
  rateLimitMap.set(ip, timestamps);

  if (timestamps.length >= maxRequests) {
    return true;
  }

  timestamps.push(now);
  return false;
}

// Periodic cleanup of stale rate limit entries (every 5 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [ip, timestamps] of rateLimitMap) {
    const active = timestamps.filter(ts => now - ts < 60000);
    if (active.length === 0) {
      rateLimitMap.delete(ip);
    } else {
      rateLimitMap.set(ip, active);
    }
  }
}, 5 * 60 * 1000);

/**
 * GET /api/recordings/:id/comments — list comments for a recording
 */
router.get('/recordings/:id/comments', (req, res) => {
  const db = getDB();
  const recordingId = req.params.id;

  // Verify recording exists
  const recording = db.prepare('SELECT id FROM recordings WHERE id = ?').get(recordingId);
  if (!recording) {
    return res.status(404).json({ error: 'Recording not found' });
  }

  const comments = db.prepare(
    'SELECT id, recording_id, author_name, text, timecode_seconds, created_at FROM video_comments WHERE recording_id = ? ORDER BY created_at ASC'
  ).all(recordingId);

  res.json({ comments });
});

/**
 * POST /api/recordings/:id/comments — add a comment
 * Body: { author_name, text, timecode_seconds? }
 * Public (no auth required), rate limited by IP
 */
router.post('/recordings/:id/comments', (req, res) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';

  if (isRateLimited(ip)) {
    return res.status(429).json({ error: 'Too many comments. Please wait a minute before posting again.' });
  }

  const db = getDB();
  const recordingId = req.params.id;
  const { author_name, text, timecode_seconds } = req.body;

  // Validate required fields
  if (!author_name || !author_name.trim()) {
    return res.status(400).json({ error: 'author_name is required' });
  }
  if (!text || !text.trim()) {
    return res.status(400).json({ error: 'text is required' });
  }

  // Validate lengths
  const trimmedName = author_name.trim().slice(0, 100);
  const trimmedText = text.trim().slice(0, 2000);

  // Validate timecode if provided
  let timecode = null;
  if (timecode_seconds !== undefined && timecode_seconds !== null) {
    timecode = parseFloat(timecode_seconds);
    if (isNaN(timecode) || timecode < 0) {
      return res.status(400).json({ error: 'timecode_seconds must be a non-negative number' });
    }
  }

  // Verify recording exists
  const recording = db.prepare('SELECT id FROM recordings WHERE id = ?').get(recordingId);
  if (!recording) {
    return res.status(404).json({ error: 'Recording not found' });
  }

  const result = db.prepare(
    'INSERT INTO video_comments (recording_id, author_name, text, timecode_seconds) VALUES (?, ?, ?, ?)'
  ).run(recordingId, trimmedName, trimmedText, timecode);

  const comment = db.prepare('SELECT * FROM video_comments WHERE id = ?').get(result.lastInsertRowid);

  res.status(201).json({ ok: true, comment });
});

/**
 * DELETE /api/recordings/:id/comments/:commentId — delete a comment
 * Requires auth (dashboard owner only)
 */
router.delete('/recordings/:id/comments/:commentId', (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required to delete comments' });
  }

  const db = getDB();
  const { id: recordingId, commentId } = req.params;

  const comment = db.prepare(
    'SELECT * FROM video_comments WHERE id = ? AND recording_id = ?'
  ).get(parseInt(commentId), recordingId);

  if (!comment) {
    return res.status(404).json({ error: 'Comment not found' });
  }

  db.prepare('DELETE FROM video_comments WHERE id = ?').run(parseInt(commentId));

  res.json({ ok: true });
});

export default router;
