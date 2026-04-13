import { Router } from 'express';
import { config } from '../config.js';

const router = Router();

const ALLOWED_TYPES = new Set(['bug', 'idea', 'question', 'other']);
const RATE_LIMIT = new Map();
const RATE_WINDOW_MS = 60 * 60 * 1000;
const RATE_MAX = 5;

function rateLimitOk(ip) {
  const now = Date.now();
  const history = (RATE_LIMIT.get(ip) || []).filter(t => now - t < RATE_WINDOW_MS);
  if (history.length >= RATE_MAX) return false;
  history.push(now);
  RATE_LIMIT.set(ip, history);
  return true;
}

/**
 * POST /api/feedback — user-submitted feedback from the dashboard.
 * Forwards to FEEDBACK_WEBHOOK_URL (generic JSON POST). Disabled if not configured.
 */
router.post('/feedback', async (req, res) => {
  const webhookUrl = config.feedback.webhookUrl;
  if (!webhookUrl) {
    return res.status(503).json({ ok: false, error: 'Feedback destination not configured' });
  }

  const ip = req.ip || 'unknown';
  if (!rateLimitOk(ip)) {
    return res.status(429).json({ ok: false, error: 'Too many requests' });
  }

  const { type, message, page_url } = req.body || {};
  const cleanType = ALLOWED_TYPES.has(type) ? type : 'other';
  const cleanMessage = typeof message === 'string' ? message.trim().slice(0, 4000) : '';

  if (cleanMessage.length < 3) {
    return res.status(400).json({ ok: false, error: 'Message is required' });
  }

  const payload = {
    source: 'bugreel-feedback',
    type: cleanType,
    message: cleanMessage,
    page_url: typeof page_url === 'string' ? page_url.slice(0, 500) : '',
    user_agent: (req.headers['user-agent'] || '').slice(0, 300),
    user_email: req.user?.email || '',
    user_name: req.user?.name || '',
    brand: config.branding.name,
    timestamp: new Date().toISOString(),
  };

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      console.error('[feedback] Webhook returned', response.status);
      return res.status(502).json({ ok: false, error: 'Failed to deliver feedback' });
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error('[feedback] Error:', err.message);
    return res.status(500).json({ ok: false, error: 'Internal error' });
  }
});

export default router;
