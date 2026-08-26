/**
 * Regression test: a merge claim must not outlive the process that took it.
 *
 * completeUpload() claims a session with `status = 'completing'` before the
 * merge and hands it back in a catch. That catch never runs when the process
 * dies mid-merge (SIGKILL, OOM, restart), and 'completing' is not in the
 * claimable set, so every later /complete attempt is turned away with a
 * retryable error and the session sits dead until its TTL expires — losing a
 * recording whose chunks are all present on disk.
 *
 * A freshly started process is by definition not merging anything, so the
 * startup sweep releases any 'completing' row it finds.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { cleanupTestData } from '../setup.js';
import { initDB, getDB } from '../../db.js';
import { initUpload, releaseStaleMergeClaims } from '../../services/chunked-upload.js';

beforeAll(() => {
  initDB();
});

afterAll(() => {
  cleanupTestData();
});

describe('releaseStaleMergeClaims()', () => {
  it('hands back sessions stuck in completing, leaves other statuses alone', () => {
    const db = getDB();

    // Stuck mid-merge when the previous process died.
    const stuck = initUpload({
      filename: 'stale-claim.webm',
      totalSize: 24,
      chunkSize: 24,
      userId: 'stale-claim-user',
    });
    db.prepare("UPDATE upload_sessions SET status = 'completing' WHERE id = ?")
      .run(stuck.upload_id);

    // Must survive the sweep untouched.
    const finished = initUpload({
      filename: 'stale-claim-done.webm',
      totalSize: 24,
      chunkSize: 24,
      userId: 'stale-claim-user',
    });
    db.prepare("UPDATE upload_sessions SET status = 'completed' WHERE id = ?")
      .run(finished.upload_id);

    const untouched = initUpload({
      filename: 'stale-claim-pending.webm',
      totalSize: 24,
      chunkSize: 24,
      userId: 'stale-claim-user',
    });
    const pendingStatusBefore = db
      .prepare('SELECT status FROM upload_sessions WHERE id = ?')
      .get(untouched.upload_id).status;

    releaseStaleMergeClaims();

    const statusOf = (id) =>
      db.prepare('SELECT status FROM upload_sessions WHERE id = ?').get(id).status;

    // Released, so the next /complete can claim it again.
    expect(statusOf(stuck.upload_id)).toBe('failed');
    expect(statusOf(finished.upload_id)).toBe('completed');
    expect(statusOf(untouched.upload_id)).toBe(pendingStatusBefore);
  });

  it('is a no-op when nothing is stuck', () => {
    const db = getDB();
    db.prepare("DELETE FROM upload_sessions WHERE status = 'completing'").run();

    expect(() => releaseStaleMergeClaims()).not.toThrow();
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM upload_sessions WHERE status = 'completing'").get().n,
    ).toBe(0);
  });
});
