/**
 * Regression test for share_token propagation through the chunked upload flow.
 *
 * Bug (2026-05-06): completeUpload() returned `{id, status}` but no
 * share_token, so the extension could only show the private dashboard URL
 * (/recording/{id}) which 404s for anonymous viewers and bounces logged-out
 * owners through the login redirect. The fix surfaces share_token end-to-end
 * so the auto-copied link after upload is the public /recording/{share_token}
 * URL instead.
 *
 * This test runs init → chunk → complete and asserts:
 *   1. completeUpload() returns a non-empty share_token
 *   2. share_token is a valid UUID
 *   3. share_token matches the recordings.share_token row written to SQLite
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { cleanupTestData } from '../setup.js';
import { initDB, getDB } from '../../db.js';
import { initUpload, uploadChunk, completeUpload } from '../../services/chunked-upload.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

beforeAll(() => {
  initDB();
});

afterAll(() => {
  cleanupTestData();
});

describe('chunked-upload share_token propagation', () => {
  it('returns share_token from completeUpload and matches DB row', async () => {
    const tinyWebm = Buffer.from('share-token-test-bytes');

    const session = initUpload({
      filename: 'share-token.webm',
      totalSize: tinyWebm.length,
      author: 'tester',
    });

    uploadChunk(session.upload_id, 0, tinyWebm);
    const result = await completeUpload(session.upload_id);

    expect(result.share_token).toBeTruthy();
    expect(result.share_token).toMatch(UUID_RE);

    const db = getDB();
    const recording = db.prepare('SELECT share_token FROM recordings WHERE id = ?').get(result.recording_id);
    expect(recording.share_token).toBe(result.share_token);
  });
});
