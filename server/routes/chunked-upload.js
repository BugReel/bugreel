import { Router } from 'express';
import { initUpload, uploadChunk, completeUpload, getStatus, cancelUpload } from '../services/chunked-upload.js';

const router = Router();

// POST /api/upload/init — create upload session
router.post('/upload/init', (req, res) => {
  try {
    const author = req.headers['x-user-name'] || req.headers['x-user-email'] || req.body.author || 'Unknown';
    // Stable owner id — same precedence as POST /upload (non-chunked path):
    // trusted X-User-Id from the Cloud Layer proxy, then req.user from local
    // auth. Without this, completeUpload would persist user_id=NULL and
    // ownsRecording() would reject every subsequent fetch as 404.
    const userId = req.headers['x-user-id'] || req.user?.id || null;
    const result = initUpload({
      filename: req.body.filename,
      totalSize: req.body.total_size,
      author,
      userId,
      metadata: req.body.metadata ? JSON.stringify(req.body.metadata) : null,
    });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
  }
});

// PUT /api/upload/:id/chunk/:index — upload single chunk (raw binary body)
router.put('/upload/:id/chunk/:index', (req, res) => {
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    try {
      const buffer = Buffer.concat(chunks);
      const chunkIndex = parseInt(req.params.index, 10);
      if (isNaN(chunkIndex)) {
        return res.status(400).json({ success: false, error: 'Invalid chunk index' });
      }
      const result = uploadChunk(req.params.id, chunkIndex, buffer);
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(err.statusCode || 500).json({ success: false, error: err.message });
    }
  });
  req.on('error', (err) => {
    res.status(500).json({ success: false, error: err.message });
  });
});

// POST /api/upload/:id/complete — merge chunks into final file
router.post('/upload/:id/complete', async (req, res) => {
  try {
    const result = await completeUpload(req.params.id);
    const body = { success: true, id: result.recording_id, status: result.status };
    if (result.share_token) body.share_token = result.share_token;
    if (result.video_url) body.video_url = result.video_url;
    res.json(body);
  } catch (err) {
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
  }
});

// GET /api/upload/:id/status — get upload progress (for resume)
router.get('/upload/:id/status', (req, res) => {
  try {
    const result = getStatus(req.params.id);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
  }
});

// DELETE /api/upload/:id — cancel upload
router.delete('/upload/:id', (req, res) => {
  try {
    const result = cancelUpload(req.params.id);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
  }
});

export default router;
