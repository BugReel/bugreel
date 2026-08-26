/**
 * Regression test for chunked-uploader.js isClientError() classification.
 *
 * Bug background: isClientError() treated every 4xx as permanent — "retrying
 * an unchanged request will just fail the same way again". True for 400/404/
 * 409, false for 408 (Request Timeout) and 429 (Too Many Requests): both
 * describe a transient condition (a slow round-trip, a rate limit — Скрини's
 * proxy path fronts /complete with exactly this), and giving up on them
 * permanently throws away an otherwise fully-uploaded recording for no
 * reason. This test drives isClientError() indirectly through the same
 * /complete retry loop the other tests in this directory exercise, since the
 * function itself isn't exported.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_PATH = path.join(here, '..', 'chunked-uploader.js');
const source = fs.readFileSync(SOURCE_PATH, 'utf8');

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
      Promise.resolve().then(() => (this._listeners.load || []).forEach((fn) => fn()));
    }
    abort() {}
  };
}

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

describe('chunked-uploader.js — isClientError() via /complete retry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it.each([408, 429])('retries /complete after a %i and succeeds on the second attempt', async (status) => {
    let completeCalls = 0;

    const sandbox = loadSandbox((url) => {
      if (url.endsWith('/init')) return jsonOk({ success: true, upload_id: `RT-${status}` });
      if (url.endsWith('/status')) return jsonOk({ success: true, uploaded_chunks: [], bytes_received: 0 });
      if (url.endsWith('/complete')) {
        completeCalls++;
        if (completeCalls === 1) return jsonErr(status, { error: 'transient' });
        return jsonOk({ success: true, id: 'REC-RT', status: 'uploaded', share_token: 'tok' });
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
    await vi.advanceTimersByTimeAsync(10_000);

    const result = await promise;

    expect(completeCalls).toBe(2);
    expect(result.id).toBe('REC-RT');
  });

  it('still gives up immediately on a genuine 4xx like 400', async () => {
    let completeCalls = 0;

    const sandbox = loadSandbox((url) => {
      if (url.endsWith('/init')) return jsonOk({ success: true, upload_id: 'RT-400' });
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
      onError: () => {},
    });
    promise.catch(() => {});

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(promise).rejects.toThrow(/HTTP 400/);
    expect(completeCalls).toBe(1);
  });
});
