import { Router } from 'express';
import crypto from 'crypto';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { config } from '../config.js';
import { getDB, generateRecordingId } from '../db.js';
import { enqueuePipeline, getQueueStatus } from '../services/pipeline.js';
import { concatRecorderSegments } from '../services/ffmpeg.js';

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
}, (req, res, next) => {
  upload.single('video')(req, res, (err) => {
    if (err) {
      // Clean up the directory if multer created it before failing
      const dir = path.join(config.dataDir, req.recordingId);
      fs.rm(dir, { recursive: true, force: true }, () => {});

      if (err.code === 'LIMIT_FILE_SIZE') {
        const maxMB = Math.round(config.maxVideoSize / (1024 * 1024));
        return res.status(413).json({
          error: 'file_too_large',
          message: `File exceeds maximum size of ${maxMB} MB`,
        });
      }
      return res.status(500).json({ error: 'upload_failed', message: err.message });
    }
    next();
  });
}, async (req, res) => {
  const id = req.recordingId;

  // Stitch multi-segment uploads (encoder auto-restarted mid-recording) into
  // a single valid WebM before the pipeline touches the file. Must run before
  // the DB insert's file_size_bytes is finalized.
  const rawSizes = req.body.recorder_segment_sizes;
  if (rawSizes) {
    try {
      const sizes = JSON.parse(rawSizes);
      if (Array.isArray(sizes) && sizes.length > 1) {
        console.log(`[upload ${id}] concat ${sizes.length} recorder segments, sizes=`, sizes);
        await concatRecorderSegments(req.file.path, sizes);
        req.file.size = fs.statSync(req.file.path).size;
      }
    } catch (err) {
      console.error(`[upload ${id}] concat failed:`, err.message);
      return res.status(500).json({ error: 'concat_failed', message: err.message });
    }
  }
  // Prefer user identity from Cloud Layer proxy headers, fall back to form body
  const author = req.headers['x-user-name'] || req.headers['x-user-email'] || req.body.author || 'Unknown';

  // stage_only: upload the (already-concatenated) bytes but don't start the
  // pipeline. The client will download the stitched blob back for local
  // preview/trim and later hit /finalize. Used when the recorder had to
  // auto-restart mid-capture — local preview of raw multi-segment blob is
  // broken, so we round-trip through the server instead of muxing in JS.
  const stageOnly = req.body.stage_only === '1' || req.body.stage_only === 'true';

  const shareToken = crypto.randomUUID();
  const initialStatus = stageOnly ? 'staged' : 'uploaded';

  // Observability: record how many MediaRecorder lifecycles contributed to
  // this upload. NULL for pre-fix clients, 1 for normal recordings, >1 when
  // the watchdog had to restart the encoder. See docs/recording-resilience.md.
  let recorderSegmentCount = null;
  if (rawSizes) {
    try {
      const sizes = JSON.parse(rawSizes);
      if (Array.isArray(sizes)) recorderSegmentCount = sizes.length;
    } catch { /* already logged above */ }
  }
  if (recorderSegmentCount === null) {
    const headerVal = parseInt(req.headers['x-recording-segments'], 10);
    if (!isNaN(headerVal) && headerVal > 0) recorderSegmentCount = headerVal;
  }

  const db = getDB();
  db.prepare(`
    INSERT INTO recordings (id, author, video_filename, file_size_bytes, status, share_token, recorder_segment_count)
    VALUES (?, ?, 'video.webm', ?, ?, ?, ?)
  `).run(id, author, req.file.size, initialStatus, shareToken, recorderSegmentCount);

  const urlEvents = req.body.url_events || null;
  const metadata = req.body.metadata || null;
  const consoleEvents = req.body.console_events || null;
  const actionEvents = req.body.action_events || null;
  const manualMarkers = req.body.manual_markers || null;
  const trimStart = req.body.trim_start ? parseFloat(req.body.trim_start) : null;
  const trimEnd = req.body.trim_end ? parseFloat(req.body.trim_end) : null;
  const segments = req.body.segments || null; // JSON string: [{start, end}, ...]

  if (urlEvents || metadata || consoleEvents || actionEvents || manualMarkers || trimStart !== null || trimEnd !== null || segments) {
    db.prepare(`UPDATE recordings SET url_events_json = ?, metadata_json = ?, console_events_json = ?, action_events_json = ?, manual_markers_json = ?, trim_start = ?, trim_end = ?, segments_json = ? WHERE id = ?`)
      .run(urlEvents, metadata, consoleEvents, actionEvents, manualMarkers, trimStart, trimEnd, segments, id);
  }

  if (stageOnly) {
    // Don't enqueuePipeline — client will call /api/recordings/:id/finalize.
    return res.json({
      id,
      status: 'staged',
      share_token: shareToken,
      video_url: `/api/recordings/${shareToken}/video`,
    });
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
