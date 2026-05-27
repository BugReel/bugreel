/**
 * Regression test for metadata field propagation through the chunked upload flow.
 *
 * Bug (2026-05-27): the extension passed metadata to chunkedUpload() as a
 * shallow spread of camelCase keys ({urlEvents, manualMarkers, ...}), but
 * completeUpload() reads snake_case keys (meta.url_events, meta.manual_markers,
 * ...) off the session blob. Result: every upload >5 MB silently lost
 * url_events_json, console_events_json, action_events_json AND
 * manual_markers_json — user-pressed screenshot markers never reached the
 * pipeline so manual frames never appeared on the timeline.
 *
 * This test pins the server contract: when the session metadata uses
 * snake_case keys, completeUpload() must persist every one of them onto the
 * recordings row. The extension fix in recorder.js converts to this shape.
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

describe('chunked-upload metadata propagation', () => {
  it('persists snake_case metadata fields onto recordings row', async () => {
    const tinyWebm = Buffer.from('metadata-test-bytes');

    const manualMarkers = JSON.stringify([{ ts: 12.3 }, { ts: 45.6 }, { ts: 78.9 }]);
    const urlEvents = JSON.stringify([{ url: 'https://example.com', ts: 0 }]);
    const consoleEvents = JSON.stringify([{ level: 'error', msg: 'boom', ts: 1 }]);
    const actionEvents = JSON.stringify([{ type: 'click', ts: 2 }]);
    const metaJson = JSON.stringify({ userAgent: 'test', screenWidth: 1920 });

    const session = initUpload({
      filename: 'metadata.webm',
      totalSize: tinyWebm.length,
      author: 'tester',
      metadata: JSON.stringify({
        url_events: urlEvents,
        console_events: consoleEvents,
        action_events: actionEvents,
        manual_markers: manualMarkers,
        metadata: metaJson,
      }),
    });

    uploadChunk(session.upload_id, 0, tinyWebm);
    const result = await completeUpload(session.upload_id);

    const db = getDB();
    const row = db.prepare(`
      SELECT manual_markers_json, url_events_json, console_events_json,
             action_events_json, metadata_json
      FROM recordings WHERE id = ?
    `).get(result.recording_id);

    expect(row.manual_markers_json).toBe(manualMarkers);
    expect(row.url_events_json).toBe(urlEvents);
    expect(row.console_events_json).toBe(consoleEvents);
    expect(row.action_events_json).toBe(actionEvents);
    expect(row.metadata_json).toBe(metaJson);
  });
});
