import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { config } from '../config.js';
import { getDB, generateRecordingId } from '../db.js';
import { enqueuePipeline, getQueueStatus } from '../services/pipeline.js';

const router = Router();

const storage = multer.diskStorage({
  destination(req, file, cb) {
    const dir = path.join(config.dataDir, req.recordingId);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename(req, file, cb) {
    cb(null, 'video.webm');
  },
});

const upload = multer({
  storage,
  limits: { fileSize: config.maxVideoSize },
});

// Generate recording ID before multer writes the file
router.post('/upload', (req, res, next) => {
  req.recordingId = generateRecordingId();
  next();
}, upload.single('video'), (req, res) => {
  const id = req.recordingId;
  const author = req.body.author || 'Unknown';

  const db = getDB();
  db.prepare(`
    INSERT INTO recordings (id, author, video_filename, file_size_bytes, status)
    VALUES (?, ?, 'video.webm', ?, 'uploaded')
  `).run(id, author, req.file.size);

  const urlEvents = req.body.url_events || null;
  const metadata = req.body.metadata || null;
  const consoleEvents = req.body.console_events || null;
  const actionEvents = req.body.action_events || null;
  const manualMarkers = req.body.manual_markers || null;

  if (urlEvents || metadata || consoleEvents || actionEvents || manualMarkers) {
    db.prepare(`UPDATE recordings SET url_events_json = ?, metadata_json = ?, console_events_json = ?, action_events_json = ?, manual_markers_json = ? WHERE id = ?`)
      .run(urlEvents, metadata, consoleEvents, actionEvents, manualMarkers, id);
  }

  // Enqueue pipeline (max 2 concurrent), catch errors
  enqueuePipeline(id).catch(err => {
    console.error(`Pipeline error for ${id}:`, err);
    db.prepare('UPDATE recordings SET status = ? WHERE id = ?').run('error', id);
  });

  const queueInfo = getQueueStatus();
  res.json({ id, status: 'uploaded', queue: queueInfo });
});

export default router;
