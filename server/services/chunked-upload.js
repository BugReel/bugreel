import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getDB, generateRecordingId } from '../db.js';
import { config } from '../config.js';
import { enqueuePipeline } from './pipeline.js';
import { concatRecorderSegments } from './ffmpeg.js';

const CHUNK_SIZE = 5 * 1024 * 1024; // 5 MB
const SESSION_TTL_HOURS = 24;
const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const CHUNKS_DIR = '_chunks';

/**
 * Initialize a chunked upload session.
 * Returns upload_id, chunk_size, total_chunks, expires_at.
 */
export function initUpload({ filename, totalSize, author, userId, metadata }) {
  if (!filename || !totalSize || totalSize <= 0) {
    throw Object.assign(new Error('Missing required fields: filename, totalSize'), { statusCode: 400 });
  }

  if (totalSize > config.maxVideoSize) {
    const maxMB = Math.round(config.maxVideoSize / (1024 * 1024));
    throw Object.assign(new Error(`File exceeds maximum size of ${maxMB} MB`), { statusCode: 413 });
  }

  const db = getDB();
  const id = crypto.randomUUID();
  const totalChunks = Math.ceil(totalSize / CHUNK_SIZE);
  const tempDir = path.join(config.dataDir, CHUNKS_DIR, id);
  fs.mkdirSync(tempDir, { recursive: true });

  const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 3600 * 1000).toISOString();

  db.prepare(`
    INSERT INTO upload_sessions (id, author, user_id, filename, total_size, chunk_size, total_chunks, temp_dir, metadata_json, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, author || 'Unknown', userId || null, filename, totalSize, CHUNK_SIZE, totalChunks, tempDir, metadata || null, expiresAt);

  return { upload_id: id, chunk_size: CHUNK_SIZE, total_chunks: totalChunks, expires_at: expiresAt };
}

/**
 * Store a single chunk on disk.
 */
export function uploadChunk(uploadId, chunkIndex, chunkBuffer) {
  const db = getDB();
  const session = db.prepare('SELECT * FROM upload_sessions WHERE id = ?').get(uploadId);
  if (!session) throw Object.assign(new Error('Upload session not found'), { statusCode: 404 });

  if (new Date(session.expires_at) < new Date()) {
    db.prepare("UPDATE upload_sessions SET status = 'failed', error_message = 'Session expired' WHERE id = ?").run(uploadId);
    throw Object.assign(new Error('Upload session expired'), { statusCode: 410 });
  }

  if (session.status === 'completed') throw Object.assign(new Error('Upload already completed'), { statusCode: 409 });
  if (session.status === 'failed') throw Object.assign(new Error('Upload session failed'), { statusCode: 410 });

  if (chunkIndex < 0 || chunkIndex >= session.total_chunks) {
    throw Object.assign(new Error(`Invalid chunk index: ${chunkIndex}`), { statusCode: 400 });
  }

  const uploadedChunks = JSON.parse(session.uploaded_chunks);

  // Idempotent: already uploaded
  if (uploadedChunks.includes(chunkIndex)) {
    const progress = (uploadedChunks.length / session.total_chunks) * 100;
    return {
      chunk_index: chunkIndex,
      status: 'already_uploaded',
      progress_percent: Math.round(progress * 100) / 100,
      chunks_uploaded: uploadedChunks.length,
      total_chunks: session.total_chunks,
    };
  }

  // Write chunk to disk
  const chunkPath = path.join(session.temp_dir, `chunk_${chunkIndex}`);
  fs.writeFileSync(chunkPath, chunkBuffer);

  // Update session
  uploadedChunks.push(chunkIndex);
  uploadedChunks.sort((a, b) => a - b);
  const newStatus = session.status === 'pending' ? 'uploading' : session.status;
  db.prepare("UPDATE upload_sessions SET uploaded_chunks = ?, status = ? WHERE id = ?")
    .run(JSON.stringify(uploadedChunks), newStatus, uploadId);

  const totalReceived = uploadedChunks.length * session.chunk_size;
  const progress = (uploadedChunks.length / session.total_chunks) * 100;

  return {
    chunk_index: chunkIndex,
    status: 'uploaded',
    progress_percent: Math.round(progress * 100) / 100,
    chunks_uploaded: uploadedChunks.length,
    total_chunks: session.total_chunks,
    total_received: Math.min(totalReceived, session.total_size),
  };
}

/**
 * Merge all chunks into the final video file, create a recording, and enqueue pipeline.
 */
export async function completeUpload(uploadId) {
  const db = getDB();
  const session = db.prepare('SELECT * FROM upload_sessions WHERE id = ?').get(uploadId);
  if (!session) throw Object.assign(new Error('Upload session not found'), { statusCode: 404 });

  if (session.status === 'completed') {
    return { upload_id: uploadId, recording_id: session.recording_id, status: 'already_completed' };
  }

  const uploadedChunks = JSON.parse(session.uploaded_chunks);
  if (uploadedChunks.length !== session.total_chunks) {
    throw Object.assign(
      new Error(`Upload incomplete: ${uploadedChunks.length}/${session.total_chunks} chunks`),
      { statusCode: 400 },
    );
  }

  // Generate recording ID and create target directory
  const recordingId = generateRecordingId();
  const recordingDir = path.join(config.dataDir, recordingId);
  fs.mkdirSync(recordingDir, { recursive: true });

  const finalPath = path.join(recordingDir, 'video.webm');

  // Streaming merge — write chunks sequentially without loading all into RAM
  const writeStream = fs.createWriteStream(finalPath);
  let totalBytesWritten = 0;

  for (let i = 0; i < session.total_chunks; i++) {
    const chunkPath = path.join(session.temp_dir, `chunk_${i}`);
    const chunkData = fs.readFileSync(chunkPath);
    writeStream.write(chunkData);
    totalBytesWritten += chunkData.length;
  }
  writeStream.end();

  // Wait for stream to flush before we try to concat or stat the file
  await new Promise((resolve, reject) => {
    writeStream.on('finish', resolve);
    writeStream.on('error', reject);
  });

  // Verify size
  if (totalBytesWritten !== session.total_size) {
    // Cleanup on mismatch
    fs.rmSync(recordingDir, { recursive: true, force: true });
    db.prepare("UPDATE upload_sessions SET status = 'failed', error_message = ? WHERE id = ?")
      .run(`Size mismatch: expected ${session.total_size}, got ${totalBytesWritten}`, uploadId);
    throw Object.assign(
      new Error(`Size mismatch: expected ${session.total_size}, got ${totalBytesWritten}`),
      { statusCode: 500 },
    );
  }

  // Parse session metadata once — we need recorderSegmentSizes BEFORE inserting
  // the recording so file_size_bytes reflects the post-concat size.
  let sessionMeta = null;
  if (session.metadata_json) {
    try { sessionMeta = JSON.parse(session.metadata_json); } catch { /* ignore */ }
  }

  // Stitch multi-segment recordings (encoder auto-restarted mid-capture) into
  // a single valid WebM. No-op for single-segment uploads.
  const segSizes = sessionMeta && Array.isArray(sessionMeta.recorderSegmentSizes)
    ? sessionMeta.recorderSegmentSizes
    : null;
  let finalBytes = totalBytesWritten;
  if (segSizes && segSizes.length > 1) {
    console.log(`[chunked-upload ${recordingId}] concat ${segSizes.length} recorder segments, sizes=`, segSizes);
    try {
      await concatRecorderSegments(finalPath, segSizes);
      finalBytes = fs.statSync(finalPath).size;
    } catch (err) {
      fs.rmSync(recordingDir, { recursive: true, force: true });
      db.prepare("UPDATE upload_sessions SET status = 'failed', error_message = ? WHERE id = ?")
        .run(`concat failed: ${err.message}`, uploadId);
      throw Object.assign(new Error(`concat failed: ${err.message}`), { statusCode: 500 });
    }
  }

  // stage_only: client wants the stitched blob back for local preview; don't
  // start the pipeline here — a later /finalize call will.
  const stageOnly = !!(sessionMeta && (sessionMeta.stage_only === '1' || sessionMeta.stage_only === true));

  // Create recording in DB
  const shareToken = crypto.randomUUID();
  const initialStatus = stageOnly ? 'staged' : 'uploaded';
  // Observability: number of MediaRecorder lifecycles that contributed to this
  // recording. >1 means the watchdog had to restart the encoder mid-capture.
  const recorderSegmentCount = Array.isArray(segSizes) ? segSizes.length : null;
  // Carry the upload session's user_id (captured at /upload/init from the
  // X-User-Id proxy header) onto the recording so multi-tenant ownership
  // checks resolve correctly. Mirrors the non-chunked /upload path.
  db.prepare(`
    INSERT INTO recordings (id, author, user_id, video_filename, file_size_bytes, status, share_token, recorder_segment_count)
    VALUES (?, ?, ?, 'video.webm', ?, ?, ?, ?)
  `).run(recordingId, session.author, session.user_id || null, finalBytes, initialStatus, shareToken, recorderSegmentCount);

  // Save metadata (url_events, console_events, etc.)
  if (sessionMeta) {
    const meta = sessionMeta;
    db.prepare(`UPDATE recordings SET url_events_json = ?, metadata_json = ?, console_events_json = ?, action_events_json = ?, manual_markers_json = ?, trim_start = ?, trim_end = ?, segments_json = ? WHERE id = ?`)
      .run(
        meta.url_events || null, meta.metadata || null,
        meta.console_events || null, meta.action_events || null,
        meta.manual_markers || null,
        meta.trim_start ? parseFloat(meta.trim_start) : null,
        meta.trim_end ? parseFloat(meta.trim_end) : null,
        meta.segments || null,
        recordingId,
      );
  }

  // Mark session completed
  db.prepare("UPDATE upload_sessions SET status = 'completed' WHERE id = ?").run(uploadId);

  // Cleanup temp chunks (fire and forget)
  fs.rm(session.temp_dir, { recursive: true, force: true }, () => {});

  if (stageOnly) {
    return {
      upload_id: uploadId,
      recording_id: recordingId,
      status: 'staged',
      share_token: shareToken,
      video_url: `/api/recordings/${shareToken}/video`,
    };
  }

  // Enqueue pipeline
  enqueuePipeline(recordingId).catch(err => {
    console.error(`Pipeline error for ${recordingId}:`, err);
    db.prepare('UPDATE recordings SET status = ? WHERE id = ?').run('error', recordingId);
  });

  // Return share_token (mirrors the stage_only branch above) so the route
  // handler — and ultimately the extension — can surface the public URL
  // /recording/{share_token} as the auto-copied link after upload.
  return { upload_id: uploadId, recording_id: recordingId, status: 'uploaded', share_token: shareToken };
}

/**
 * Get upload session status for resume.
 */
export function getStatus(uploadId) {
  const db = getDB();
  const session = db.prepare('SELECT * FROM upload_sessions WHERE id = ?').get(uploadId);
  if (!session) throw Object.assign(new Error('Upload session not found'), { statusCode: 404 });

  const uploadedChunks = JSON.parse(session.uploaded_chunks);
  const bytesReceived = Math.min(uploadedChunks.length * session.chunk_size, session.total_size);
  const isExpired = new Date(session.expires_at) < new Date();

  return {
    upload_id: session.id,
    status: isExpired && session.status !== 'completed' ? 'expired' : session.status,
    is_expired: isExpired,
    uploaded_chunks: uploadedChunks,
    chunks_uploaded: uploadedChunks.length,
    total_chunks: session.total_chunks,
    chunk_size: session.chunk_size,
    total_size: session.total_size,
    bytes_received: bytesReceived,
    progress_percent: Math.round((uploadedChunks.length / session.total_chunks) * 10000) / 100,
    expires_at: session.expires_at,
  };
}

/**
 * Cancel an upload and clean up temp files.
 */
export function cancelUpload(uploadId) {
  const db = getDB();
  const session = db.prepare('SELECT * FROM upload_sessions WHERE id = ?').get(uploadId);
  if (!session) throw Object.assign(new Error('Upload session not found'), { statusCode: 404 });

  if (session.status === 'completed') {
    throw Object.assign(new Error('Cannot cancel completed upload'), { statusCode: 409 });
  }

  fs.rm(session.temp_dir, { recursive: true, force: true }, () => {});
  db.prepare('DELETE FROM upload_sessions WHERE id = ?').run(uploadId);

  return { upload_id: uploadId, status: 'cancelled' };
}

/**
 * Clean up expired upload sessions. Called periodically.
 */
export function cleanupExpiredSessions() {
  const db = getDB();
  const expired = db.prepare(
    "SELECT id, temp_dir FROM upload_sessions WHERE status != 'completed' AND expires_at < datetime('now')",
  ).all();

  for (const session of expired) {
    fs.rm(session.temp_dir, { recursive: true, force: true }, () => {});
    db.prepare('DELETE FROM upload_sessions WHERE id = ?').run(session.id);
  }

  if (expired.length > 0) {
    console.log(`[chunked-upload] Cleaned up ${expired.length} expired session(s)`);
  }
}

/**
 * Start periodic cleanup. Call after initDB().
 */
let cleanupStarted = false;
export function startCleanupTimer() {
  if (cleanupStarted) return;
  cleanupStarted = true;
  cleanupExpiredSessions();
  setInterval(cleanupExpiredSessions, CLEANUP_INTERVAL_MS);
}
