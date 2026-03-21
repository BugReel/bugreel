import { Router } from 'express';
import crypto from 'crypto';
import { getDB } from '../db.js';
import { requireAuth } from '../auth.js';

const router = Router();

/**
 * Hash an IP address with SHA-256 so we never store raw IPs.
 * Uses a static salt to keep hashes consistent for rate-limiting.
 */
function hashIP(ip) {
  return crypto.createHash('sha256').update(`bugreel-view-salt:${ip}`).digest('hex');
}

/**
 * Extract client IP from request, respecting X-Forwarded-For behind proxies.
 */
function getClientIP(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.connection?.remoteAddress || '0.0.0.0';
}

/**
 * POST /api/analytics/view
 * Log a page view for a recording (public, called from report page).
 *
 * Body: { recording_id }
 * Rate limit: max 1 view per IP per recording per hour.
 * Returns: { ok, view_id } or { ok, duplicate } if rate-limited.
 */
router.post('/analytics/view', (req, res) => {
  const { recording_id } = req.body;
  if (!recording_id) {
    return res.status(400).json({ error: 'recording_id is required' });
  }

  const db = getDB();

  // Verify recording exists
  const recording = db.prepare('SELECT id FROM recordings WHERE id = ?').get(recording_id);
  if (!recording) {
    return res.status(404).json({ error: 'Recording not found' });
  }

  const viewerHash = hashIP(getClientIP(req));
  const userAgent = req.headers['user-agent'] || '';
  const referrer = req.headers['referer'] || req.headers['referrer'] || '';

  // Rate limit: check for existing view from same IP+recording in the last hour
  const recentView = db.prepare(`
    SELECT id FROM views
    WHERE recording_id = ? AND viewer_hash = ? AND created_at > datetime('now', '-1 hour')
    ORDER BY created_at DESC LIMIT 1
  `).get(recording_id, viewerHash);

  if (recentView) {
    return res.json({ ok: true, duplicate: true, view_id: recentView.id });
  }

  // Insert new view
  const result = db.prepare(`
    INSERT INTO views (recording_id, viewer_hash, user_agent, referrer)
    VALUES (?, ?, ?, ?)
  `).run(recording_id, viewerHash, userAgent, referrer);

  res.json({ ok: true, view_id: result.lastInsertRowid });
});

/**
 * POST /api/analytics/heartbeat
 * Update watch duration for an existing view (called every 30s from client).
 *
 * Body: { view_id, seconds } — seconds is the increment (typically 30).
 */
router.post('/analytics/heartbeat', (req, res) => {
  const { view_id, seconds } = req.body;

  if (!view_id || typeof seconds !== 'number' || seconds < 0) {
    return res.status(400).json({ error: 'view_id and seconds (number >= 0) are required' });
  }

  // Cap single heartbeat increment to 60s to prevent abuse
  const increment = Math.min(seconds, 60);

  const db = getDB();
  const result = db.prepare(`
    UPDATE views SET duration_seconds = duration_seconds + ? WHERE id = ?
  `).run(increment, view_id);

  if (result.changes === 0) {
    return res.status(404).json({ error: 'View not found' });
  }

  res.json({ ok: true });
});

/**
 * GET /api/analytics/:recordingId
 * Get view statistics for a recording (authenticated users only).
 *
 * Returns:
 *   total_views          — total view count
 *   unique_viewers       — count of distinct viewer hashes
 *   avg_watch_duration   — average watch duration in seconds
 *   max_watch_duration   — longest watch session in seconds
 *   views_by_day         — array of { date, count } for last 30 days
 *   recent_views         — last 20 views with metadata
 */
router.get('/analytics/:recordingId', requireAuth, (req, res) => {
  const { recordingId } = req.params;
  const db = getDB();

  // Verify recording exists
  const recording = db.prepare('SELECT id FROM recordings WHERE id = ?').get(recordingId);
  if (!recording) {
    return res.status(404).json({ error: 'Recording not found' });
  }

  // Aggregate stats
  const stats = db.prepare(`
    SELECT
      COUNT(*) as total_views,
      COUNT(DISTINCT viewer_hash) as unique_viewers,
      COALESCE(ROUND(AVG(duration_seconds)), 0) as avg_watch_duration,
      COALESCE(MAX(duration_seconds), 0) as max_watch_duration
    FROM views
    WHERE recording_id = ?
  `).get(recordingId);

  // Views by day (last 30 days)
  const viewsByDay = db.prepare(`
    SELECT DATE(created_at) as date, COUNT(*) as count
    FROM views
    WHERE recording_id = ? AND created_at > datetime('now', '-30 days')
    GROUP BY DATE(created_at)
    ORDER BY date ASC
  `).all(recordingId);

  // Recent views (last 20)
  const recentViews = db.prepare(`
    SELECT id, viewer_hash, user_agent, referrer, created_at, duration_seconds
    FROM views
    WHERE recording_id = ?
    ORDER BY created_at DESC
    LIMIT 20
  `).all(recordingId);

  res.json({
    recording_id: recordingId,
    ...stats,
    views_by_day: viewsByDay,
    recent_views: recentViews,
  });
});

/**
 * GET /api/analytics/views
 * Aggregated view analytics across all recordings (authenticated).
 *
 * Returns:
 *   total_views          — total view count
 *   unique_viewers       — distinct viewer hashes
 *   avg_watch_duration   — average watch duration in seconds
 *   views_by_day         — array of { date, count } for last 30 days
 *   top_recordings       — top 10 recordings by view count
 */
router.get('/analytics/views', requireAuth, (req, res) => {
  const db = getDB();

  // Aggregate stats
  const stats = db.prepare(`
    SELECT
      COUNT(*) as total_views,
      COUNT(DISTINCT viewer_hash) as unique_viewers,
      COALESCE(ROUND(AVG(duration_seconds)), 0) as avg_watch_duration
    FROM views
  `).get();

  // Views by day (last 30 days)
  const viewsByDay = db.prepare(`
    SELECT DATE(created_at) as date, COUNT(*) as count
    FROM views
    WHERE created_at > datetime('now', '-30 days')
    GROUP BY DATE(created_at)
    ORDER BY date ASC
  `).all();

  // Top recordings by views
  const topRecordings = db.prepare(`
    SELECT
      v.recording_id,
      COUNT(*) as view_count,
      COUNT(DISTINCT v.viewer_hash) as unique_viewers,
      COALESCE(ROUND(AVG(v.duration_seconds)), 0) as avg_watch_duration,
      r.author,
      r.created_at,
      c.title as card_title
    FROM views v
    LEFT JOIN recordings r ON r.id = v.recording_id
    LEFT JOIN cards c ON c.recording_id = v.recording_id
    GROUP BY v.recording_id
    ORDER BY view_count DESC
    LIMIT 10
  `).all();

  res.json({
    ...stats,
    views_by_day: viewsByDay,
    top_recordings: topRecordings,
  });
});

export default router;
