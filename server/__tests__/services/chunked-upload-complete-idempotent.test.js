/**
 * Regression test: retrying POST /complete after it already succeeded must
 * return the SAME recording (id + share_token), not a bare acknowledgement.
 *
 * Scenario this guards: completeUpload() finalizes the recording and marks
 * the session 'completed', but the HTTP response never reaches the client
 * (network drop, proxy timeout) — the client's auto-retry hits /complete a
 * second time for the same upload_id. Before this fix, the early-return
 * branch for an already-completed session read `session.recording_id` off a
 * column that never existed on `upload_sessions`, so the retry silently came
 * back as `{success:true, id: undefined, status:'already_completed'}` — the
 * client couldn't tell the upload actually succeeded and would report the
 * recording lost even though it existed on disk.
 */

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

describe('chunked-upload completeUpload() idempotent retry', () => {
  it('returns the same recording_id/share_token/status on a repeated call', async () => {
    const tinyWebm = Buffer.from('idempotent-complete-test-bytes');

    const session = initUpload({
      filename: 'idempotent.webm',
      totalSize: tinyWebm.length,
      author: 'tester',
    });

    uploadChunk(session.upload_id, 0, tinyWebm);

    const first = await completeUpload(session.upload_id);
    expect(first.status).toBe('uploaded');
    expect(first.recording_id).toBeTruthy();
    expect(first.share_token).toBeTruthy();

    // Simulates the client's retry after losing the first response.
    const second = await completeUpload(session.upload_id);

    expect(second.recording_id).toBe(first.recording_id);
    expect(second.share_token).toBe(first.share_token);
    // The retry hits the early-return branch and must know the real
    // outcome, not the generic 'already_completed' fallback.
    expect(second.status).toBe('uploaded');

    // Only one recording was ever created — the retry must not re-run the
    // merge/insert path.
    const db = getDB();
    const count = db.prepare('SELECT COUNT(*) AS n FROM recordings WHERE id = ?').get(first.recording_id).n;
    expect(count).toBe(1);
  });
});
