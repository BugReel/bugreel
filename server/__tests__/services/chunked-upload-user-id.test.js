/**
 * Regression test for user_id propagation through the chunked upload flow.
 *
 * Bug (2026-05-06): /upload/init never persisted user_id, so completeUpload
 * INSERT'd recordings with user_id=NULL. Multi-tenant deployments
 * (TRUST_PROXY_AUTH=true) then 404'd every chunked upload because
 * ownsRecording() checks recording.user_id === req.user.id.
 *
 * This test creates a chunked upload session with a userId, walks it through
 * init → chunk → complete, and asserts the resulting recordings.user_id row
 * matches what was passed in.
 */

process.env.TRUST_PROXY_AUTH = 'true';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { cleanupTestData } from '../setup.js';
import { initDB, getDB } from '../../db.js';
import { initUpload, uploadChunk, completeUpload } from '../../services/chunked-upload.js';

beforeAll(() => {
  initDB();
});

afterAll(() => {
  cleanupTestData();
});

describe('chunked-upload userId propagation', () => {
  it('persists userId from init through to recordings.user_id', async () => {
    const userId = 'user-abc-123';
    const tinyWebm = Buffer.from('tiny-webm-bytes-for-test');

    const session = initUpload({
      filename: 'test.webm',
      totalSize: tinyWebm.length,
      author: 'tester',
      userId,
    });

    // Sanity — session row carries user_id
    const db = getDB();
    const sessionRow = db.prepare('SELECT user_id FROM upload_sessions WHERE id = ?').get(session.upload_id);
    expect(sessionRow.user_id).toBe(userId);

    uploadChunk(session.upload_id, 0, tinyWebm);
    const result = await completeUpload(session.upload_id);

    const recording = db.prepare('SELECT user_id FROM recordings WHERE id = ?').get(result.recording_id);
    expect(recording.user_id).toBe(userId);
  });

  it('falls back to NULL user_id when init omits userId (self-hosted compat)', async () => {
    const tinyWebm = Buffer.from('another-tiny-blob');

    const session = initUpload({
      filename: 'test.webm',
      totalSize: tinyWebm.length,
      author: 'tester',
      // no userId
    });

    uploadChunk(session.upload_id, 0, tinyWebm);
    const result = await completeUpload(session.upload_id);

    const db = getDB();
    const recording = db.prepare('SELECT user_id FROM recordings WHERE id = ?').get(result.recording_id);
    expect(recording.user_id).toBeNull();
  });
});
