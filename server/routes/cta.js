import { Router } from 'express';
import { getDB } from '../db.js';

const router = Router();

/**
 * GET /recordings/:id/cta — list CTA buttons for a recording
 */
router.get('/recordings/:id/cta', (req, res) => {
  const db = getDB();
  const rows = db.prepare('SELECT * FROM cta_buttons WHERE recording_id = ? ORDER BY created_at ASC').all(req.params.id);
  res.json(rows);
});

/**
 * POST /recordings/:id/cta — create a CTA button
 */
router.post('/recordings/:id/cta', (req, res) => {
  const db = getDB();
  const { label, url, bg_color, text_color, position, show_at_seconds } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'url is required' });
  }

  const result = db.prepare(`
    INSERT INTO cta_buttons (recording_id, label, url, bg_color, text_color, position, show_at_seconds)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.params.id,
    label || 'Learn More',
    url,
    bg_color || '#3b82f6',
    text_color || '#ffffff',
    position || 'end',
    show_at_seconds ?? null
  );

  const row = db.prepare('SELECT * FROM cta_buttons WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(row);
});

/**
 * PUT /cta/:ctaId — update a CTA button
 */
router.put('/cta/:ctaId', (req, res) => {
  const db = getDB();
  const existing = db.prepare('SELECT * FROM cta_buttons WHERE id = ?').get(req.params.ctaId);
  if (!existing) {
    return res.status(404).json({ error: 'CTA button not found' });
  }

  const { label, url, bg_color, text_color, position, show_at_seconds, enabled } = req.body;

  db.prepare(`
    UPDATE cta_buttons
    SET label = ?, url = ?, bg_color = ?, text_color = ?, position = ?, show_at_seconds = ?, enabled = ?
    WHERE id = ?
  `).run(
    label ?? existing.label,
    url ?? existing.url,
    bg_color ?? existing.bg_color,
    text_color ?? existing.text_color,
    position ?? existing.position,
    show_at_seconds !== undefined ? show_at_seconds : existing.show_at_seconds,
    enabled !== undefined ? (enabled ? 1 : 0) : existing.enabled,
    req.params.ctaId
  );

  const row = db.prepare('SELECT * FROM cta_buttons WHERE id = ?').get(req.params.ctaId);
  res.json(row);
});

/**
 * DELETE /cta/:ctaId — delete a CTA button
 */
router.delete('/cta/:ctaId', (req, res) => {
  const db = getDB();
  const result = db.prepare('DELETE FROM cta_buttons WHERE id = ?').run(req.params.ctaId);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'CTA button not found' });
  }
  res.json({ ok: true });
});

export default router;
