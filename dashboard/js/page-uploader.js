/**
 * page-uploader.js — Chunked upload for the in-browser recorder (dashboard)
 *
 * Browser port of extension/chunked-uploader.js adapted for same-origin
 * dashboard context:
 *   - No chrome.* APIs — state is held in module-level variables (memory only).
 *   - Auth via session cookie (credentials: 'same-origin'); no Bearer token.
 *   - All URLs are relative (/api/upload/...) — same-origin only.
 *   - Pause/cancel not exposed in MVP (the recorder shows a single Upload button;
 *     cancel can be wired later via the `controller` object below).
 *
 * Cross-reload resume is intentionally NOT implemented in this MVP. The upload
 * state lives in the module closure and is lost on page reload. If the user
 * navigates away mid-upload the beforeunload guard in recorder-page.js warns
 * them. Full resume would require persisting upload_id to sessionStorage/IDB
 * and re-fetching /status on load — left as a future improvement.
 */

const CHUNK_SIZE    = 5 * 1024 * 1024; // 5 MB — must match server/services/chunked-upload.js
const CHUNK_CONCURRENCY = 3;            // chunks in flight at once (see uploadAllChunks)
const MAX_RETRIES   = 5;
const RETRY_BASE_DELAY = 2000;          // 2s → 4s → 8s → 16s → 32s
const AUTO_RETRY_MAX   = 3;
const AUTO_RETRY_DELAYS = [3000, 6000, 9000];
const STALL_TIMEOUT = 45_000;           // 45s with no bytes flowing → abort chunk
const HARD_TIMEOUT  = 10 * 60 * 1000;  // 10 min absolute ceiling per chunk

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Upload a Blob to the server using the standard chunked-upload pipeline.
 *
 * @param {Blob}   blob
 * @param {Object} opts
 * @param {number}   [opts.durationSec]  Recording duration in seconds
 * @param {Object}   [opts.metadata]     Extra metadata (passed to /upload/init body)
 * @param {Function} [opts.onProgress]   (percent, bytesUploaded, bytesTotal)
 * @returns {Promise<{id: string, share_token: string, status: string}>}
 */
export async function chunkedUploadFromPage(blob, opts = {}) {
  const {
    durationSec,
    metadata,
    onProgress = () => {},
  } = opts;

  const totalSize   = blob.size;
  const totalChunks = Math.ceil(totalSize / CHUNK_SIZE);

  // ── Step 1: Init session ────────────────────────────────────────────────
  const initBody = {
    filename:   `recording-${Date.now()}.webm`,
    total_size: totalSize,
    // `author` is intentionally omitted here — the server reads it from the
    // X-User-Name/X-User-Email proxy headers (set by the Cloud Layer when the
    // request passes through). No need to duplicate it in the body.
  };

  // Attach metadata to init so the server stores it with the session.
  // For in-browser recordings there are no content-script events, so most
  // fields will be null/empty. We add source for observability only.
  const mergedMeta = {
    metadata: JSON.stringify({ source: 'in-browser' }),
    ...(metadata || {}),
  };
  initBody.metadata = mergedMeta;

  const initRes = await jsonRequest('/api/upload/init', {
    method: 'POST',
    body: initBody,
    durationSec,
  });

  if (!initRes.success) {
    throw new Error(initRes.error || 'Failed to initialise upload');
  }

  const upload_id = initRes.upload_id;

  // ── Step 2: Upload chunks with auto-retry ────────────────────────────────
  let autoRetryCount = 0;

  while (autoRetryCount <= AUTO_RETRY_MAX) {
    try {
      await uploadAllChunks(blob, { upload_id, totalSize, totalChunks, durationSec, onProgress });
      break; // success
    } catch (err) {
      if (err?.__cancelled) {
        // Cancel: ask server to discard partial session
        try { await jsonRequest(`/api/upload/${upload_id}`, { method: 'DELETE' }); } catch { /* ignore */ }
        throw err;
      }
      if (isTerminalStatus(err?.status)) throw err;
      autoRetryCount++;
      if (autoRetryCount > AUTO_RETRY_MAX) throw err;
      console.warn(`[page-uploader] auto-retry ${autoRetryCount}/${AUTO_RETRY_MAX}:`, err.message);
      await sleep(AUTO_RETRY_DELAYS[autoRetryCount - 1] ?? 3000);
    }
  }

  // ── Step 3: Complete ────────────────────────────────────────────────────
  const completeRes = await jsonRequest(`/api/upload/${upload_id}/complete`, {
    method: 'POST',
    durationSec,
  });

  if (!completeRes.success) {
    throw new Error(completeRes.error || 'Failed to complete upload');
  }

  return {
    id:          completeRes.id,
    share_token: completeRes.share_token,
    status:      completeRes.status,
  };
}

// ---------------------------------------------------------------------------
// Internal: chunk loop
// ---------------------------------------------------------------------------

async function uploadAllChunks(blob, { upload_id, totalSize, totalChunks, durationSec, onProgress }) {
  // Fetch server-side state so we can resume a partially-uploaded session that
  // survived an auto-retry without dropping the connection entirely.
  let uploadedChunks = [];
  let bytesUploaded  = 0;

  try {
    const status = await jsonRequest(`/api/upload/${upload_id}/status`, { method: 'GET' });
    if (status.success) {
      uploadedChunks = status.uploaded_chunks || [];
      bytesUploaded  = status.bytes_received  || 0;
    }
  } catch { /* start from scratch */ }

  // Emit initial progress to unfreeze the progress bar during the init round-trip
  onProgress(Math.round((bytesUploaded / totalSize) * 100), bytesUploaded, totalSize);

  const pending = [];
  for (let i = 0; i < totalChunks; i++) {
    if (!uploadedChunks.includes(i)) pending.push(i);
  }

  // Progress is aggregated across the workers: completed chunks plus the bytes
  // currently in flight in each one.
  let completedBytes = bytesUploaded;
  const inFlight = new Map(); // chunkIndex → bytes sent so far

  const emit = () => {
    let sum = completedBytes;
    for (const n of inFlight.values()) sum += n;
    const capped = Math.min(sum, totalSize);
    onProgress(Math.round((capped / totalSize) * 100), capped, totalSize);
  };

  let cursor = 0;
  const worker = async () => {
    while (true) {
      const i = cursor++;
      if (i >= pending.length) return;
      const index     = pending[i];
      const start     = index * CHUNK_SIZE;
      const end       = Math.min(start + CHUNK_SIZE, totalSize);
      const chunkBlob = blob.slice(start, end);
      const chunkSize = end - start;

      inFlight.set(index, 0);
      try {
        await uploadChunkWithRetry(chunkBlob, {
          upload_id, chunkIndex: index, durationSec,
          onChunkBytes: (loaded) => { inFlight.set(index, loaded); emit(); },
        });
      } finally {
        inFlight.delete(index);
      }
      completedBytes += chunkSize;
      emit();
    }
  };

  // Chunks are independent on the server (each is written to its own file and the
  // session row is updated synchronously), so several can be in flight at once.
  // On a high-latency link this is what turns a serial 30 s/chunk crawl into a
  // usable upload — sequential chunking was leaving most of the uplink idle.
  const workers = Math.min(CHUNK_CONCURRENCY, Math.max(1, pending.length));
  await Promise.all(Array.from({ length: workers }, () => worker()));
}

// ---------------------------------------------------------------------------
// Internal: per-chunk retry
// ---------------------------------------------------------------------------

async function uploadChunkWithRetry(chunkBlob, opts) {
  const { upload_id, chunkIndex, durationSec, onChunkBytes } = opts;
  let lastError = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const result = await uploadSingleChunk(chunkBlob, {
        url:  `/api/upload/${upload_id}/chunk/${chunkIndex}`,
        durationSec,
        onChunkProgress: (loaded) => { if (onChunkBytes) onChunkBytes(loaded); },
      });

      if (result.success) return result;
      lastError = new Error(result.error || 'Chunk upload failed');
    } catch (err) {
      lastError = err;
      // A rejected session (expired/failed/completed) or a bad request will be
      // rejected identically on every attempt — retrying just makes the user
      // wait through the whole backoff ladder before the same error.
      if (isTerminalStatus(err?.status)) throw err;
    }

    if (attempt < MAX_RETRIES - 1) {
      await sleep(RETRY_BASE_DELAY * Math.pow(2, attempt));
    }
  }

  throw lastError || new Error(`Max retries exceeded for chunk ${chunkIndex}`);
}

// ---------------------------------------------------------------------------
// Internal: XHR for a single chunk (progress + stall watchdog)
// ---------------------------------------------------------------------------

function uploadSingleChunk(chunkBlob, { url, durationSec, onChunkProgress }) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    let watcher       = null;
    let lastProgressAt = Date.now();
    let lastLoaded    = 0;
    const startedAt   = Date.now();
    let stalledOut    = false;
    let hardTimedOut  = false;

    xhr.upload.addEventListener('progress', (e) => {
      if (e.loaded !== lastLoaded) {
        lastLoaded = e.loaded;
        lastProgressAt = Date.now();
      }
      if (e.lengthComputable && onChunkProgress) {
        onChunkProgress(e.loaded, e.total);
      }
    });

    const cleanup = () => { if (watcher) { clearInterval(watcher); watcher = null; } };

    xhr.addEventListener('load', () => {
      cleanup();
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          reject(new Error('Invalid JSON response from server'));
        }
      } else {
        let msg = '';
        try { msg = JSON.parse(xhr.responseText)?.error || ''; } catch { /* not JSON */ }
        reject(Object.assign(
          new Error(msg || `HTTP ${xhr.status}: ${(xhr.responseText || '').slice(0, 200)}`),
          { status: xhr.status },
        ));
      }
    });

    xhr.addEventListener('error',   () => { cleanup(); reject(new Error('Network error')); });
    xhr.addEventListener('timeout', () => { cleanup(); reject(new Error('Chunk upload timed out')); });
    xhr.addEventListener('abort',   () => {
      cleanup();
      if (stalledOut)   return reject(new Error(`Chunk stalled (no progress for ${Math.round(STALL_TIMEOUT / 1000)}s)`));
      if (hardTimedOut) return reject(new Error(`Chunk exceeded hard timeout (${Math.round(HARD_TIMEOUT / 1000)}s)`));
      reject(new Error('Upload aborted'));
    });

    xhr.open('PUT', url);
    // No xhr.timeout — it's a hard cap that fails on slow links for 5 MB chunks.
    // We use a progress-based stall watchdog instead (same reasoning as the extension).
    xhr.withCredentials = true; // send session cookie (same-origin, but explicit)
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    if (durationSec) xhr.setRequestHeader('X-Recording-Duration', String(durationSec));

    xhr.send(chunkBlob);

    // Combined 250ms watcher: stall detection + hard ceiling
    watcher = setInterval(() => {
      const now = Date.now();
      if (now - lastProgressAt > STALL_TIMEOUT) {
        stalledOut = true;
        try { xhr.abort(); } catch { /* ignore */ }
        return;
      }
      if (now - startedAt > HARD_TIMEOUT) {
        hardTimedOut = true;
        try { xhr.abort(); } catch { /* ignore */ }
      }
    }, 250);
  });
}

// ---------------------------------------------------------------------------
// Internal: fetch wrapper for JSON API calls (init / complete / status / delete)
// ---------------------------------------------------------------------------

async function jsonRequest(url, { method = 'GET', body, durationSec } = {}) {
  const opts = {
    method,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
  };
  if (durationSec) opts.headers['X-Recording-Duration'] = String(durationSec);
  if (body && method !== 'GET') opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);
  if (!res.ok) {
    // Surface the server's own message when it sends one — a raw "HTTP 413:
    // {json}" in the error panel tells the user nothing about what to do.
    let raw = '';
    try { raw = await res.text(); } catch { /* ignore */ }
    let msg = '';
    try { msg = JSON.parse(raw)?.error || JSON.parse(raw)?.message || ''; } catch { /* not JSON */ }
    if (!msg) msg = `HTTP ${res.status}${raw ? ': ' + raw.slice(0, 200) : ''}`;
    throw Object.assign(new Error(msg), { status: res.status });
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Util
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** 4xx that will not change on retry (408 Timeout / 429 Too Many are excluded). */
function isTerminalStatus(status) {
  return typeof status === 'number' && status >= 400 && status < 500 && status !== 408 && status !== 429;
}
