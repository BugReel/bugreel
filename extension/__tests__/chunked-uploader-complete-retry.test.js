/**
 * Regression test for chunked-uploader.js Step 3 (/complete) retry handling.
 *
 * Bug background: chunk uploads carry two layers of retry (per-chunk ×5,
 * upload-level auto-retry ×3), but the final POST /complete call — which
 * merges already-uploaded chunks into a recording server-side — was fired
 * exactly once with no retry at all. A single transient failure there
 * (e.g. cloud proxy briefly unable to reach Core) threw away an otherwise
 * fully-uploaded recording.
 *
 * Fix: /complete now retries with the same AUTO_RETRY_MAX/AUTO_RETRY_DELAYS
 * budget used elsewhere in this file, but only for network errors and 5xx —
 * never for a 4xx (the request itself is invalid, retrying won't help) or a
 * user cancellation.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_PATH = path.join(here, '..', 'chunked-uploader.js');
const source = fs.readFileSync(SOURCE_PATH, 'utf8');

const AUTO_RETRY_MAX = Number(source.match(/const\s+AUTO_RETRY_MAX\s*=\s*(\d+)/)[1]);

// Chunk uploads succeed immediately — this test is only about Step 3.
function makeInstantXHR() {
  return class FakeXHR {
    constructor() {
      this.upload = { addEventListener: () => {} };
      this._listeners = {};
      this.status = 0;
      this.responseText = '';
    }
    addEventListener(e, fn) { (this._listeners[e] ||= []).push(fn); }
    open() {}
    setRequestHeader() {}
    send() {
      this.status = 200;
      this.responseText = JSON.stringify({ success: true, total_received: 1 });
      // Resolve on next tick so the test can drive fake timers deterministically.
      Promise.resolve().then(() => (this._listeners.load || []).forEach((fn) => fn()));
    }
    abort() {}
  };
}

// Builds a sandbox with a scriptable `fetch` used by apiRequest() — /init,
// /status and /complete all go through it. `onFetch` lets each test decide
// per-call behavior by URL.
function loadSandbox(onFetch) {
  const sandbox = {
    console,
    Date,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    XMLHttpRequest: makeInstantXHR(),
    fetch: async (url, opts) => onFetch(url, opts),
    chrome: { storage: { local: { set: async () => {}, remove: async () => {} } } },
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return sandbox;
}

function jsonOk(body) {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
}
function jsonErr(status, body = { error: 'error' }) {
  return { ok: false, status, json: async () => body, text: async () => JSON.stringify(body) };
}

describe('chunked-uploader.js — /complete retry (Step 3)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('retries /complete after a transient 502 and succeeds on the second attempt', async () => {
    let completeCalls = 0;
    const errors = [];

    const sandbox = loadSandbox((url) => {
      if (url.endsWith('/init')) return jsonOk({ success: true, upload_id: 'U1' });
      if (url.endsWith('/status')) return jsonOk({ success: true, uploaded_chunks: [], bytes_received: 0 });
      if (url.endsWith('/complete')) {
        completeCalls++;
        if (completeCalls === 1) return jsonErr(502, { error: 'core_unavailable' });
        return jsonOk({ success: true, id: 'REC-1', status: 'uploaded', share_token: 'tok' });
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    const blob = { size: 1024, slice: (a, b) => ({ size: b - a }) };
    const promise = sandbox.chunkedUpload(blob, {
      serverUrl: 'https://example', author: 'a', token: 't',
      controller: { paused: false, cancelled: false },
      onError: (err) => errors.push(err),
    });
    promise.catch(() => {});

    // Let init/status/chunk/first-complete settle, then run the backoff timer.
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(10_000); // covers AUTO_RETRY_DELAYS[0] = 3000ms

    const result = await promise;

    expect(completeCalls).toBe(2);
    expect(result.id).toBe('REC-1');
    expect(errors).toHaveLength(0); // succeeded before exhausting retries — no onError
  });

  it('does not retry a 4xx from /complete and surfaces it immediately', async () => {
    let completeCalls = 0;
    const errors = [];

    const sandbox = loadSandbox((url) => {
      if (url.endsWith('/init')) return jsonOk({ success: true, upload_id: 'U2' });
      if (url.endsWith('/status')) return jsonOk({ success: true, uploaded_chunks: [], bytes_received: 0 });
      if (url.endsWith('/complete')) {
        completeCalls++;
        return jsonErr(400, { error: 'Upload incomplete' });
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    const blob = { size: 1024, slice: (a, b) => ({ size: b - a }) };
    const promise = sandbox.chunkedUpload(blob, {
      serverUrl: 'https://example', author: 'a', token: 't',
      controller: { paused: false, cancelled: false },
      onError: (err) => errors.push(err),
    });
    promise.catch(() => {});

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
    // No backoff should ever fire for a 4xx — advance well past one retry
    // delay to prove no second attempt happens.
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(promise).rejects.toThrow(/HTTP 400/);
    expect(completeCalls).toBe(1); // never retried
    expect(errors).toHaveLength(0); // 4xx bypasses onError — it's not a canResume case
  });

  it('recovers when attempt 1 drops the response but Core already finalized (idempotent retry)', async () => {
    // Simulates: the POST reached Core, Core finalized the recording, but the
    // HTTP response never made it back (network drop after processing).
    // fetch() itself rejects here — no res.status, exactly like a real
    // connection failure — while the retry hits Core's idempotent
    // already-completed branch and gets the SAME id/share_token back.
    let completeCalls = 0;

    const sandbox = loadSandbox((url) => {
      if (url.endsWith('/init')) return jsonOk({ success: true, upload_id: 'U4' });
      if (url.endsWith('/status')) return jsonOk({ success: true, uploaded_chunks: [], bytes_received: 0 });
      if (url.endsWith('/complete')) {
        completeCalls++;
        if (completeCalls === 1) throw new Error('Failed to fetch'); // no .status — real network failure
        return jsonOk({ success: true, id: 'REC-2', status: 'already_completed', share_token: 'tok-2' });
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    const blob = { size: 1024, slice: (a, b) => ({ size: b - a }) };
    const promise = sandbox.chunkedUpload(blob, {
      serverUrl: 'https://example', author: 'a', token: 't',
      controller: { paused: false, cancelled: false },
      onError: () => {},
    });
    promise.catch(() => {});

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(10_000); // covers the backoff before attempt 2

    const result = await promise;

    expect(completeCalls).toBe(2);
    expect(result.id).toBe('REC-2');
    expect(result.shareToken).toBe('tok-2');
  });

  it('gives up after AUTO_RETRY_MAX attempts, calls onError(canResume=true), and never clears state', async () => {
    let completeCalls = 0;
    let stateCleared = false;
    const errors = [];

    const sandbox = (() => {
      const s = {
        console, Date, setTimeout, clearTimeout, setInterval, clearInterval,
        XMLHttpRequest: makeInstantXHR(),
        fetch: async (url) => {
          if (url.endsWith('/init')) return jsonOk({ success: true, upload_id: 'U3' });
          if (url.endsWith('/status')) return jsonOk({ success: true, uploaded_chunks: [], bytes_received: 0 });
          if (url.endsWith('/complete')) {
            completeCalls++;
            return jsonErr(503, { error: 'core_unavailable' });
          }
          throw new Error(`unexpected fetch ${url}`);
        },
        chrome: { storage: { local: {
          set: async () => {},
          remove: async () => { stateCleared = true; },
        } } },
      };
      vm.createContext(s);
      vm.runInContext(source, s);
      return s;
    })();

    const blob = { size: 1024, slice: (a, b) => ({ size: b - a }) };
    const promise = sandbox.chunkedUpload(blob, {
      serverUrl: 'https://example', author: 'a', token: 't',
      controller: { paused: false, cancelled: false },
      onError: (err, canResume) => errors.push({ err, canResume }),
    });
    promise.catch(() => {});

    // Drain the whole retry budget: AUTO_RETRY_MAX+1 attempts, each followed
    // by a backoff sleep.
    for (let i = 0; i <= AUTO_RETRY_MAX + 1; i++) {
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(10_000);
    }

    await expect(promise).rejects.toThrow(/HTTP 503/);
    expect(completeCalls).toBe(AUTO_RETRY_MAX + 1); // 1 initial + AUTO_RETRY_MAX retries
    expect(errors).toHaveLength(1);
    expect(errors[0].canResume).toBe(true);
    expect(stateCleared).toBe(false); // state must survive so the upload can resume
  });

  it('treats success:true with no id as a failure, not a completed upload', async () => {
    // Regression: a legacy session row (pre-migration, NULL recording_id) or
    // any other server-side gap that lets /complete answer 2xx without an
    // id used to sail straight through — clearState() ran and the caller
    // got { id: undefined, ... }. recorder.js then shows "uploaded" with a
    // dead link (recordingId falls back to the literal string 'unknown').
    let completeCalls = 0;
    let stateCleared = false;
    const errors = [];

    const sandbox = (() => {
      const s = {
        console, Date, setTimeout, clearTimeout, setInterval, clearInterval,
        XMLHttpRequest: makeInstantXHR(),
        fetch: async (url) => {
          if (url.endsWith('/init')) return jsonOk({ success: true, upload_id: 'U5' });
          if (url.endsWith('/status')) return jsonOk({ success: true, uploaded_chunks: [], bytes_received: 0 });
          if (url.endsWith('/complete')) {
            completeCalls++;
            // success:true but no id — e.g. an already-completed legacy
            // session row with no recording_id column populated.
            return jsonOk({ success: true, status: 'already_completed' });
          }
          throw new Error(`unexpected fetch ${url}`);
        },
        chrome: { storage: { local: {
          set: async () => {},
          remove: async () => { stateCleared = true; },
        } } },
      };
      vm.createContext(s);
      vm.runInContext(source, s);
      return s;
    })();

    const blob = { size: 1024, slice: (a, b) => ({ size: b - a }) };
    const promise = sandbox.chunkedUpload(blob, {
      serverUrl: 'https://example', author: 'a', token: 't',
      controller: { paused: false, cancelled: false },
      onError: (err, canResume) => errors.push({ err, canResume }),
    });
    promise.catch(() => {});

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);

    await expect(promise).rejects.toThrow(/missing recording id/i);
    expect(completeCalls).toBe(1); // 2xx never retries in this loop — see the loop's break-on-success
    expect(errors).toHaveLength(1);
    expect(errors[0].canResume).toBe(true);
    expect(stateCleared).toBe(false); // must NOT clear state on this path
  });
});
