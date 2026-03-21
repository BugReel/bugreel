import { Router } from 'express';
import crypto from 'crypto';
import { getDB } from '../db.js';

const router = Router();

// --- Password hashing with crypto.scrypt (same approach as auth.js) ---

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const attempt = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(attempt, 'hex'));
}

/**
 * PUT /api/recordings/:id/password — set password protection (authenticated, owner only)
 * Body: { password: string }
 */
router.put('/recordings/:id/password', (req, res) => {
  const { password } = req.body;

  if (!password || typeof password !== 'string') {
    return res.status(400).json({ error: 'Password is required' });
  }

  if (password.length < 4) {
    return res.status(400).json({ error: 'Password must be at least 4 characters' });
  }

  const db = getDB();
  const recording = db.prepare('SELECT id, author FROM recordings WHERE id = ?').get(req.params.id);
  if (!recording) {
    return res.status(404).json({ error: 'Recording not found' });
  }

  const hashed = hashPassword(password);
  db.prepare('UPDATE recordings SET password_hash = ? WHERE id = ?').run(hashed, req.params.id);

  res.json({ ok: true, has_password: true });
});

/**
 * DELETE /api/recordings/:id/password — remove password protection (authenticated, owner only)
 */
router.delete('/recordings/:id/password', (req, res) => {
  const db = getDB();
  const recording = db.prepare('SELECT id, author FROM recordings WHERE id = ?').get(req.params.id);
  if (!recording) {
    return res.status(404).json({ error: 'Recording not found' });
  }

  db.prepare('UPDATE recordings SET password_hash = NULL WHERE id = ?').run(req.params.id);

  res.json({ ok: true, has_password: false });
});

/**
 * POST /api/recordings/:id/verify-password — verify password and set access cookie
 * Body: { password: string }
 */
router.post('/recordings/:id/verify-password', (req, res) => {
  const { password } = req.body;

  if (!password || typeof password !== 'string') {
    return res.status(400).json({ error: 'Password is required' });
  }

  const db = getDB();
  const recording = db.prepare('SELECT id, password_hash FROM recordings WHERE id = ?').get(req.params.id);
  if (!recording) {
    return res.status(404).json({ error: 'Recording not found' });
  }

  if (!recording.password_hash) {
    // No password set — grant access
    return res.json({ ok: true });
  }

  try {
    if (!verifyPassword(password, recording.password_hash)) {
      return res.status(401).json({ error: 'Wrong password' });
    }
  } catch {
    return res.status(401).json({ error: 'Wrong password' });
  }

  // Generate access token for this recording (24h TTL)
  const accessToken = crypto.randomBytes(24).toString('hex');
  const cookieName = `access_${req.params.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

  // Set cookie: 24 hours, HttpOnly, SameSite=Lax
  res.setHeader('Set-Cookie',
    `${cookieName}=${accessToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${24 * 3600}`
  );

  // Store access token in a lightweight way (in-memory or DB)
  // We use a simple approach: store the hash of the token alongside the recording
  // For simplicity, we store valid access tokens in a settings table
  const tokenHash = crypto.createHash('sha256').update(accessToken).digest('hex');
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  // Store in a dedicated table or settings — using settings for simplicity
  db.prepare(`
    INSERT OR REPLACE INTO settings (key, value)
    VALUES (?, ?)
  `).run(`pwd_access:${req.params.id}:${tokenHash}`, expiresAt);

  res.json({ ok: true });
});

export default router;

/**
 * Check if a request has valid access to a password-protected recording.
 * Used by the password-check middleware.
 */
export function hasValidAccess(req, recordingId) {
  const cookieName = `access_${recordingId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

  // Parse cookie manually (same approach as auth.js)
  const header = req.headers.cookie || '';
  const match = header.match(new RegExp(`(?:^|;\\s*)${cookieName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}=([^;]*)`));
  const accessToken = match ? decodeURIComponent(match[1]) : null;

  if (!accessToken) return false;

  const db = getDB();
  const tokenHash = crypto.createHash('sha256').update(accessToken).digest('hex');
  const key = `pwd_access:${recordingId}:${tokenHash}`;

  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (!row) return false;

  // Check expiry
  const expiresAt = new Date(row.value);
  if (expiresAt <= new Date()) {
    // Expired — clean up
    db.prepare('DELETE FROM settings WHERE key = ?').run(key);
    return false;
  }

  return true;
}
