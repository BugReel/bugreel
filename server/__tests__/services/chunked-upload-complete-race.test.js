/**
 * Regression test: two concurrent POST /complete calls for the same upload
 * session (the extension now retries /complete ~3s after a transient
 * failure — see chunked-uploader-complete-retry.test.js) must not both reach
 * the merge/INSERT path.
 *
 * Bug background: the only gate was `session.status === 'completed'`, set on
 * the LAST line of completeUpload() after the writeStream flush and the
 * ffmpeg concat (tens of seconds). Nothing guarded the window between entry
 * and that line, so two concurrent calls both passed the gate and both
 * reached the recordings INSERT: one interleaving hit a
 * generateRecordingId() PK collision (bare 500), another created a *second*
 * recording row plus a duplicate enqueuePipeline() (paid re-transcription/
 * re-analysis), and the winner's temp_dir cleanup could delete chunk files
 * out from under the loser's still-running readFileSync loop.
 *
 * Fix: an atomic `UPDATE ... WHERE status IN (...)` claims the row before
 * the merge starts. The loser is turned away with a retryable (non-4xx)
 * error before touching any chunk file or the recordings table.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import { cleanupTestData } from '../setup.js';
import { initDB, getDB } from '../../db.js';
import { initUpload, uploadChunk, completeUpload } from '../../services/chunked-upload.js';

vi.mock('../../services/pipeline.js', () => ({
  enqueuePipeline: vi.fn().mockResolvedValue(undefined),
}));

beforeAll(() => {
  initDB();
});

afterAll(() => {
  cleanupTestData();
});

describe('chunked-upload completeUpload() concurrent race', () => {
  it('one caller wins, the other gets a retryable (non-4xx) error, exactly one recording/pipeline run', async () => {
    const { enqueuePipeline } = await import('../../services/pipeline.js');

    const tinyWebm = Buffer.from('race-complete-test-bytes');
    const session = initUpload({
      filename: 'race.webm',
      totalSize: tinyWebm.length,
      author: 'tester',
    });
    uploadChunk(session.upload_id, 0, tinyWebm);

    const db = getDB();
    const before = db.prepare('SELECT temp_dir FROM upload_sessions WHERE id = ?').get(session.upload_id);
    expect(fs.existsSync(before.temp_dir)).toBe(true);

    // Both calls are issued without awaiting individually — this is what
    // makes the race real: each runs synchronously up to its first await,
    // so the second call's atomic claim attempt genuinely lands while the
    // first is mid-merge (status already flipped to 'completing').
    const p1 = completeUpload(session.upload_id);
    const p2 = completeUpload(session.upload_id);

    const results = await Promise.allSettled([p1, p2]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    // Retryable: NOT a 4xx. The extension's isClientError() treats any
    // err.statusCode in [400,500) as permanent and gives up without
    // retrying — a 4xx here would silently lose the recording forever on
    // the very race this fix targets.
    const rejection = rejected[0].reason;
    expect(rejection.statusCode).toBeGreaterThanOrEqual(500);
    expect(rejection.statusCode).toBeLessThan(600);

    const recordingId = fulfilled[0].value.recording_id;
    expect(recordingId).toBeTruthy();

    const count = db.prepare('SELECT COUNT(*) AS n FROM recordings WHERE id = ?').get(recordingId).n;
    expect(count).toBe(1);

    expect(enqueuePipeline).toHaveBeenCalledTimes(1);
    expect(enqueuePipeline).toHaveBeenCalledWith(recordingId);

    // The winning session row settled as 'completed', not stuck mid-claim.
    const after = db.prepare('SELECT status FROM upload_sessions WHERE id = ?').get(session.upload_id);
    expect(after.status).toBe('completed');
  });
});
