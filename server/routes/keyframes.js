import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { getDB } from '../db.js';
import { config } from '../config.js';
import { extractFrame } from '../services/ffmpeg.js';

const router = Router();

// Batch-update keyframe timecodes
router.put('/recordings/:id/keyframes', (req, res) => {
  const db = getDB();
  const { keyframes } = req.body;

  if (!Array.isArray(keyframes)) {
    return res.status(400).json({ error: 'keyframes array is required' });
  }

  const recording = db.prepare('SELECT id FROM recordings WHERE id = ?').get(req.params.id);
  if (!recording) return res.status(404).json({ error: 'Recording not found' });

  const update = db.prepare('UPDATE frames SET time_seconds = ? WHERE id = ? AND recording_id = ?');
  const updateMany = db.transaction((items) => {
    for (const kf of items) {
      update.run(kf.time_seconds, kf.id, req.params.id);
    }
  });
  updateMany(keyframes);

  const updated = db.prepare('SELECT * FROM frames WHERE recording_id = ? ORDER BY time_seconds').all(req.params.id);
  res.json({ ok: true, frames: updated });
});

// Add a new keyframe — immediately extracts JPEG
router.post('/recordings/:id/keyframes', async (req, res) => {
  const db = getDB();
  const { time_seconds, description } = req.body;

  if (time_seconds == null) {
    return res.status(400).json({ error: 'time_seconds is required' });
  }

  const recording = db.prepare('SELECT id FROM recordings WHERE id = ?').get(req.params.id);
  if (!recording) return res.status(404).json({ error: 'Recording not found' });

  // Check max keyframes
  const count = db.prepare("SELECT COUNT(*) as count FROM frames WHERE recording_id = ? AND filename != ''").get(req.params.id);
  if (count.count >= 20) {
    return res.status(400).json({ error: 'Maximum 20 keyframes allowed' });
  }

  const result = db.prepare(
    'INSERT INTO frames (recording_id, time_seconds, description, filename) VALUES (?, ?, ?, ?)'
  ).run(req.params.id, time_seconds, description || '', '');

  const frameId = Number(result.lastInsertRowid);
  let filename = '';

  // Extract JPEG immediately
  const videoPath = path.join(config.dataDir, req.params.id, 'video.webm');
  if (fs.existsSync(videoPath)) {
    try {
      const framesDir = path.join(config.dataDir, req.params.id, 'frames');
      fs.mkdirSync(framesDir, { recursive: true });
      const idx = count.count + 1;
      filename = `${String(idx).padStart(3, '0')}_${time_seconds.toFixed(1)}s.jpg`;
      await extractFrame(videoPath, time_seconds, path.join(framesDir, filename));
      db.prepare('UPDATE frames SET filename = ? WHERE id = ?').run(filename, frameId);
    } catch (err) {
      console.error(`[Keyframe] Failed to extract frame at ${time_seconds}s:`, err.message);
      filename = '';
    }
  }

  res.json({ ok: true, frame: { id: frameId, time_seconds, description: description || '', filename } });
});

// Delete a keyframe
router.delete('/recordings/:id/keyframes/:frameId', (req, res) => {
  const db = getDB();

  const frame = db.prepare('SELECT * FROM frames WHERE id = ? AND recording_id = ?').get(req.params.frameId, req.params.id);
  if (!frame) return res.status(404).json({ error: 'Frame not found' });

  // Delete file if exists
  if (frame.filename) {
    const framePath = path.join(config.dataDir, req.params.id, 'frames', frame.filename);
    try { fs.unlinkSync(framePath); } catch {}
  }

  db.prepare('DELETE FROM frames WHERE id = ?').run(req.params.frameId);
  res.json({ ok: true });
});

// Regenerate frame JPEGs from current timecodes via ffmpeg
router.post('/recordings/:id/regenerate-frames', async (req, res) => {
  const db = getDB();

  const recording = db.prepare('SELECT * FROM recordings WHERE id = ?').get(req.params.id);
  if (!recording) return res.status(404).json({ error: 'Recording not found' });

  const videoPath = path.join(config.dataDir, req.params.id, 'video.webm');
  if (!fs.existsSync(videoPath)) {
    return res.status(404).json({ error: 'Video file not found' });
  }

  const framesDir = path.join(config.dataDir, req.params.id, 'frames');
  fs.mkdirSync(framesDir, { recursive: true });

  const frames = db.prepare('SELECT * FROM frames WHERE recording_id = ? ORDER BY time_seconds').all(req.params.id);

  const results = [];
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    const filename = `${String(i + 1).padStart(3, '0')}_${frame.time_seconds.toFixed(1)}s.jpg`;
    const framePath = path.join(framesDir, filename);

    try {
      // Delete old file if different name
      if (frame.filename && frame.filename !== filename) {
        const oldPath = path.join(framesDir, frame.filename);
        try { fs.unlinkSync(oldPath); } catch {}
      }

      await extractFrame(videoPath, frame.time_seconds, framePath);
      db.prepare('UPDATE frames SET filename = ? WHERE id = ?').run(filename, frame.id);
      results.push({ id: frame.id, filename, time_seconds: frame.time_seconds, status: 'ok' });
    } catch (err) {
      results.push({ id: frame.id, time_seconds: frame.time_seconds, status: 'error', error: err.message });
    }
  }

  res.json({ ok: true, frames: results });
});

export default router;
