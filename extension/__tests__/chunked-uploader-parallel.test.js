/**
 * Тесты параллельной заливки чанков в chunked-uploader.js.
 *
 * До правки расширение слало чанки строго по одному: между чанками простаивал
 * целый RTT, и на дальнем канале это заметная доля времени аплоада. Браузерный
 * рекордер держит 3 чанка в полёте — расширение теперь тоже.
 *
 * Что тут сторожится:
 *   - в полёте больше одного чанка, но не больше PARALLEL_CHUNKS;
 *   - доезжают все чанки, каждый ровно один раз;
 *   - полоска прогресса не едет назад, когда стартует очередной воркер
 *     (при параллельной заливке это первый способ сломать UI);
 *   - отмена всплывает наверх, а не тонет в одном из воркеров.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_PATH = path.join(here, '..', 'chunked-uploader.js');
const source = fs.readFileSync(SOURCE_PATH, 'utf8');

const PARALLEL_CHUNKS = Number(source.match(/const\s+PARALLEL_CHUNKS\s*=\s*(\d+)/)[1]);
const CHUNK_SIZE = 5 * 1024 * 1024;

// XHR, который завершает чанк не сразу, а по внешней отмашке — так тест видит,
// сколько запросов держится в полёте одновременно.
function makeControllableXHR(state) {
  return class FakeXHR {
    constructor() {
      this.upload = { _l: {}, addEventListener: (e, fn) => { (this.upload._l[e] ||= []).push(fn); } };
      this._l = {};
      this.status = 0;
      this.responseText = '';
      state.all.push(this);
    }
    addEventListener(e, fn) { (this._l[e] ||= []).push(fn); }
    open(method, url) { this._url = url; }
    setRequestHeader() {}
    abort() { (this._l.abort || []).forEach(fn => fn()); }
    send() {
      state.inflight.add(this);
      state.peak = Math.max(state.peak, state.inflight.size);
      state.pending.push(this);
      state.wake();
    }
    emitProgress(loaded) {
      (this.upload._l.progress || []).forEach(fn => fn({ loaded, total: CHUNK_SIZE, lengthComputable: true }));
    }
    finish() {
      state.inflight.delete(this);
      this.status = 200;
      this.responseText = JSON.stringify({ success: true, total_received: CHUNK_SIZE });
      (this._l.load || []).forEach(fn => fn());
    }
    fail() {
      state.inflight.delete(this);
      (this._l.error || []).forEach(fn => fn());
    }
    get chunkIndex() { return Number(this._url.split('/').pop()); }
  };
}

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

// Блоб-заглушка: slice() отдаёт объект нужного размера, больше от него ничего
// не требуется — XHR его не читает.
function fakeBlob(totalSize) {
  return { size: totalSize, slice: (a, b) => ({ size: b - a }) };
}

describe('chunked-uploader.js — параллельная заливка чанков', () => {
  let state, sandbox;

  beforeEach(() => {
    state = { all: [], inflight: new Set(), pending: [], peak: 0, wake: () => {} };
    sandbox = loadSandbox(makeControllableXHR(state));
  });

  // Ждём, пока воркеры создадут очередной запрос.
  async function waitForRequests(n) {
    for (let i = 0; i < 200 && state.pending.length < n; i++) {
      await new Promise(r => setTimeout(r, 0));
    }
  }

  it('держит несколько чанков в полёте, но не больше PARALLEL_CHUNKS', async () => {
    const totalChunks = 7;
    const totalSize = CHUNK_SIZE * totalChunks;
    const done = [];

    const promise = sandbox.uploadAllChunks(fakeBlob(totalSize), {
      apiBase: 'https://example/api/upload', upload_id: 'U', token: 't',
      durationSec: 10, totalSize, totalChunks,
      controller: { cancelled: false, paused: false },
      onProgress: () => {}, onChunkComplete: (i) => done.push(i), onPauseStateChange: () => {},
      serverUrl: 'https://example',
    });

    // Разбираем запросы по мере появления, отвечая на самый старый.
    for (let guard = 0; guard < 100 && done.length < totalChunks; guard++) {
      await waitForRequests(1);
      const xhr = state.pending.shift();
      if (xhr) xhr.finish();
      await new Promise(r => setTimeout(r, 0));
    }
    await promise;

    expect(state.peak).toBeGreaterThan(1);
    expect(state.peak).toBeLessThanOrEqual(PARALLEL_CHUNKS);
    expect(done.slice().sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    // Каждый чанк ушёл ровно один раз — воркеры не разобрали одну задачу дважды.
    expect(new Set(state.all.map(x => x.chunkIndex)).size).toBe(totalChunks);
  });

  it('прогресс не едет назад, когда стартует очередной воркер', async () => {
    const totalChunks = 5;
    const totalSize = CHUNK_SIZE * totalChunks;
    const seen = [];
    const done = [];

    const promise = sandbox.uploadAllChunks(fakeBlob(totalSize), {
      apiBase: 'https://example/api/upload', upload_id: 'U', token: 't',
      durationSec: 10, totalSize, totalChunks,
      controller: { cancelled: false, paused: false },
      onProgress: (_p, bytes) => seen.push(bytes),
      onChunkComplete: (i) => done.push(i), onPauseStateChange: () => {},
      serverUrl: 'https://example',
    });

    for (let guard = 0; guard < 100 && done.length < totalChunks; guard++) {
      await waitForRequests(1);
      const xhr = state.pending.shift();
      if (xhr) {
        xhr.emitProgress(CHUNK_SIZE / 2); // чанк на середине
        xhr.finish();
      }
      await new Promise(r => setTimeout(r, 0));
    }
    await promise;

    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
    }
    expect(seen.at(-1)).toBe(totalSize);
  });

  it('отмена всплывает наверх, а не тонет в одном из воркеров', async () => {
    const totalChunks = 6;
    const totalSize = CHUNK_SIZE * totalChunks;
    const controller = { cancelled: false, paused: false };

    const promise = sandbox.uploadAllChunks(fakeBlob(totalSize), {
      apiBase: 'https://example/api/upload', upload_id: 'U', token: 't',
      durationSec: 10, totalSize, totalChunks,
      controller,
      onProgress: () => {}, onChunkComplete: () => {}, onPauseStateChange: () => {},
      serverUrl: 'https://example',
    });

    await waitForRequests(PARALLEL_CHUNKS);
    controller.cancelled = true;
    state.pending.splice(0).forEach(x => x.finish());

    await expect(promise).rejects.toMatchObject({ __cancelled: true });
  });
});
