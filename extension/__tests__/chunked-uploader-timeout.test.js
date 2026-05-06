/**
 * Regression test for chunked-uploader.js timeout handling.
 *
 * Bug background: a hard `xhr.timeout = 30_000` aborted in-flight chunks at
 * ~3 MB on slow uplinks (Vietnam, ~100 KB/s). The retry restarted from
 * byte 0 of the chunk → upload looped forever, never made it past 50%.
 *
 * Fix: removed `xhr.timeout`, added a progress-based stall watchdog
 * (STALL_TIMEOUT = 45s with no bytes flowing) plus a hard ceiling
 * (HARD_TIMEOUT = 10 min absolute per chunk).
 *
 * These tests guard the new behavior against regressions.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_PATH = path.join(here, '..', 'chunked-uploader.js');
const source = fs.readFileSync(SOURCE_PATH, 'utf8');

// `const` declarations don't become properties of the vm sandbox, so we read
// the literal numeric constants out of the source to drive timer-based tests.
function readConst(name) {
  const re = new RegExp(`const\\s+${name}\\s*=\\s*([0-9_*\\s]+)\\s*;`);
  const m = source.match(re);
  if (!m) throw new Error(`constant ${name} not found in chunked-uploader.js`);
  // eslint-disable-next-line no-eval — trusted source, controlled regex
  return eval(m[1].replace(/_/g, ''));
}
const STALL_TIMEOUT = readConst('STALL_TIMEOUT');
const HARD_TIMEOUT = readConst('HARD_TIMEOUT');

// Build a sandbox that provides everything chunked-uploader.js touches:
// XMLHttpRequest, chrome.storage.local, fetch, console, timers.
function loadSandbox(FakeXHR) {
  const sandbox = {
    console,
    Date,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    XMLHttpRequest: FakeXHR,
    fetch: async () => ({ ok: true, json: async () => ({ success: true }) }),
    chrome: { storage: { local: { set: async () => {}, remove: async () => {} } } },
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return sandbox;
}

// Minimal XHR stub: tracks whether `timeout` was assigned (regression guard),
// captures listeners, lets the test drive `progress`, `load`, and `abort`.
function makeFakeXHR(registry) {
  return class FakeXHR {
    constructor() {
      this.upload = { _listeners: {}, addEventListener: (e, fn) => { (this.upload._listeners[e] ||= []).push(fn); } };
      this._listeners = {};
      this.status = 0;
      this.responseText = '';
      this._timeoutAssigned = null; // null = never assigned (good)
      this._aborted = false;
      this._headers = {};
      this._sentBody = null;
      registry.push(this);
    }
    set timeout(v) { this._timeoutAssigned = v; }
    get timeout() { return this._timeoutAssigned ?? 0; }
    addEventListener(e, fn) { (this._listeners[e] ||= []).push(fn); }
    open(method, url) { this._method = method; this._url = url; }
    setRequestHeader(k, v) { this._headers[k] = v; }
    send(body) { this._sentBody = body; }
    abort() { this._aborted = true; this._dispatch('abort'); }
    _dispatchUpload(ev, payload) { (this.upload._listeners[ev] || []).forEach((fn) => fn(payload)); }
    _dispatch(ev, payload) { (this._listeners[ev] || []).forEach((fn) => fn(payload)); }
    // Test helper: simulate a chunk byte counter advancing.
    progress(loaded, total) {
      this._dispatchUpload('progress', { loaded, total, lengthComputable: true });
    }
    succeed(body = '{"success":true,"total_received":5242880}') {
      this.status = 200;
      this.responseText = body;
      this._dispatch('load');
    }
  };
}

describe('chunked-uploader.js — progress-based watchdog (no hard 30s cap)', () => {
  let xhrs;
  let FakeXHR;
  let sandbox;
  let uploadSingleChunk;

  beforeEach(() => {
    vi.useFakeTimers();
    xhrs = [];
    FakeXHR = makeFakeXHR(xhrs);
    sandbox = loadSandbox(FakeXHR);
    uploadSingleChunk = sandbox.uploadSingleChunk;
  });

  it('declares sane stall/hard-timeout constants (no XHR_TIMEOUT regression)', () => {
    expect(typeof STALL_TIMEOUT).toBe('number');
    expect(STALL_TIMEOUT).toBeGreaterThanOrEqual(30_000); // ≥30 s no-progress
    expect(typeof HARD_TIMEOUT).toBe('number');
    expect(HARD_TIMEOUT).toBeGreaterThanOrEqual(60_000);  // ≥1 min ceiling
    // Old hard cap must NOT come back.
    expect(/const\s+XHR_TIMEOUT\b/.test(source)).toBe(false);
  });

  it('source has no `xhr.timeout = <small>` regression', () => {
    // Defense-in-depth: even if someone re-adds an xhr.timeout assignment,
    // the constant must be referenced from a sandbox-visible name we can
    // assert lower-bounds on. A bare `xhr.timeout = 30_000` would fail
    // the timer-based test below, but this static check catches it earlier
    // and points the reviewer straight at the bug.
    const offendingPattern = /xhr\.timeout\s*=\s*\d+/;
    expect(offendingPattern.test(source)).toBe(false);
  });

  it('does NOT abort a slow upload that keeps making progress', async () => {
    const promise = uploadSingleChunk(
      { size: 5 * 1024 * 1024 },
      { url: 'https://example/api/upload/X/chunk/0', token: 't', controller: { cancelled: false }, onChunkProgress: () => {} },
    );
    promise.catch(() => {}); // suppress unhandled-rejection between fake-timer ticks
    // Wait for send() to register the watchdog interval.
    await vi.advanceTimersByTimeAsync(0);
    const xhr = xhrs[0];
    expect(xhr).toBeTruthy();
    expect(xhr._timeoutAssigned).toBeNull(); // no hard cap assigned

    // Simulate 60 s of slow but continuous progress (well past the old
    // 30 s cap that used to kill these). Tick every 5 s, +250 KB each.
    const total = 5 * 1024 * 1024;
    let loaded = 0;
    for (let t = 0; t < 60; t += 5) {
      loaded += 250 * 1024;
      xhr.progress(loaded, total);
      await vi.advanceTimersByTimeAsync(5_000);
    }
    expect(xhr._aborted).toBe(false);

    // Finish cleanly.
    xhr.progress(total, total);
    xhr.succeed();
    const result = await promise;
    expect(result.success).toBe(true);
  });

  it('aborts when progress goes silent for STALL_TIMEOUT', async () => {
    const promise = uploadSingleChunk(
      { size: 5 * 1024 * 1024 },
      { url: 'https://example/api/upload/X/chunk/0', token: 't', controller: { cancelled: false }, onChunkProgress: () => {} },
    );
    promise.catch(() => {});
    await vi.advanceTimersByTimeAsync(0);
    const xhr = xhrs[0];

    // First emit some progress so the stall timer has a baseline.
    xhr.progress(1024 * 1024, 5 * 1024 * 1024);
    await vi.advanceTimersByTimeAsync(1000);
    expect(xhr._aborted).toBe(false);

    // Now go silent past STALL_TIMEOUT.
    await vi.advanceTimersByTimeAsync(STALL_TIMEOUT + 500);
    expect(xhr._aborted).toBe(true);

    // The promise should reject with a stall message.
    await expect(promise).rejects.toThrow(/stalled/i);
  });

  it('honors a controller.cancelled flag mid-chunk (still works after watchdog refactor)', async () => {
    const controller = { cancelled: false };
    const promise = uploadSingleChunk(
      { size: 5 * 1024 * 1024 },
      { url: 'https://example/api/upload/X/chunk/0', token: 't', controller, onChunkProgress: () => {} },
    );
    promise.catch(() => {});
    await vi.advanceTimersByTimeAsync(0);
    const xhr = xhrs[0];

    xhr.progress(512 * 1024, 5 * 1024 * 1024);
    await vi.advanceTimersByTimeAsync(500);

    controller.cancelled = true;
    await vi.advanceTimersByTimeAsync(500);
    expect(xhr._aborted).toBe(true);

    await expect(promise).rejects.toMatchObject({ __cancelled: true });
  });
});
