/**
 * ChunkedUploader — chunked file upload for BugReel extension
 *
 * Features:
 * - Upload large files (up to 4 GB) in 5 MB chunks
 * - Resume uploads after connection interruption
 * - Per-chunk retry with exponential backoff (5 attempts)
 * - Auto-retry at upload level (3 attempts)
 * - Smooth two-level progress tracking (overall + within current chunk)
 * - chrome.storage.local persistence for resume across extension restarts
 *
 * Adapted from v2t/youtest.ru chunked-uploader.js for Chrome extension context.
 */

const CHUNK_SIZE = 5 * 1024 * 1024; // 5 MB
const MAX_RETRIES = 5;
const RETRY_BASE_DELAY = 2000; // 2s, exponential: 2s, 4s, 8s, 16s, 32s
const AUTO_RETRY_MAX = 3;
const AUTO_RETRY_DELAYS = [3000, 6000, 9000];
const XHR_TIMEOUT = 30000; // 30s per chunk

/**
 * Upload a blob in chunks to the BugReel server.
 *
 * @param {Blob} blob - The video blob to upload
 * @param {Object} options
 * @param {string} options.serverUrl - Base URL (e.g. 'https://skrini.ru')
 * @param {string} options.author - Author name
 * @param {string} [options.token] - Bearer token for auth
 * @param {number} [options.durationSec] - Recording duration in seconds
 * @param {Object} [options.metadata] - Extra metadata (url_events, console_events, etc.)
 * @param {function} [options.onProgress] - Callback: (percent, bytesUploaded, bytesTotal)
 * @param {function} [options.onChunkComplete] - Callback: (chunkIndex, totalChunks)
 * @param {function} [options.onError] - Callback: (error, canResume)
 * @returns {Promise<{id: string, status: string}>} Recording result
 */
// eslint-disable-next-line no-unused-vars — called from recorder.js
async function chunkedUpload(blob, options = {}) {
  const {
    serverUrl, author, token, durationSec, metadata,
    onProgress = () => {},
    onChunkComplete = () => {},
    onError = () => {},
  } = options;

  const apiBase = `${serverUrl}/api/upload`;
  const totalSize = blob.size;
  const totalChunks = Math.ceil(totalSize / CHUNK_SIZE);

  // --- Step 1: Init session ---
  const initBody = {
    filename: `recording-${Date.now()}.webm`,
    total_size: totalSize,
    author: author || 'unknown',
  };
  if (metadata) initBody.metadata = metadata;

  const initRes = await apiRequest(`${apiBase}/init`, {
    method: 'POST',
    token,
    durationSec,
    body: initBody,
  });

  if (!initRes.success) {
    throw new Error(initRes.error || 'Failed to initialize upload');
  }

  const { upload_id } = initRes;

  // Save state for resume
  await saveState(upload_id, {
    serverUrl, author, token, durationSec,
    totalSize, totalChunks,
    uploadedChunks: [],
    bytesUploaded: 0,
  });

  // --- Step 2: Upload chunks with auto-retry ---
  let autoRetryCount = 0;

  while (autoRetryCount <= AUTO_RETRY_MAX) {
    try {
      await uploadAllChunks(blob, {
        apiBase, upload_id, token, durationSec,
        totalSize, totalChunks,
        onProgress, onChunkComplete,
      });
      break; // success
    } catch (err) {
      autoRetryCount++;
      if (autoRetryCount > AUTO_RETRY_MAX) {
        onError(err, true); // canResume=true
        throw err;
      }
      console.warn(`[ChunkedUploader] Auto-retry ${autoRetryCount}/${AUTO_RETRY_MAX} after error:`, err.message);
      await sleep(AUTO_RETRY_DELAYS[autoRetryCount - 1] || 3000);
    }
  }

  // --- Step 3: Complete ---
  const completeRes = await apiRequest(`${apiBase}/${upload_id}/complete`, {
    method: 'POST',
    token,
    durationSec,
  });

  if (!completeRes.success) {
    throw new Error(completeRes.error || 'Failed to complete upload');
  }

  // Clear saved state
  await clearState(upload_id);

  return { id: completeRes.id, status: completeRes.status };
}

/**
 * Upload all remaining chunks for a session.
 */
async function uploadAllChunks(blob, opts) {
  const { apiBase, upload_id, token, durationSec, totalSize, totalChunks, onProgress, onChunkComplete } = opts;

  // Fetch server status to get already-uploaded chunks (for resume)
  let uploadedChunks = [];
  let bytesUploaded = 0;

  try {
    const status = await apiRequest(`${apiBase}/${upload_id}/status`, { method: 'GET', token });
    if (status.success) {
      uploadedChunks = status.uploaded_chunks || [];
      bytesUploaded = status.bytes_received || 0;
    }
  } catch { /* start from scratch */ }

  for (let i = 0; i < totalChunks; i++) {
    if (uploadedChunks.includes(i)) continue; // already uploaded

    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, totalSize);
    const chunkBlob = blob.slice(start, end);
    const chunkSize = end - start;

    // Upload with per-chunk retry
    const result = await uploadChunkWithRetry(chunkBlob, {
      apiBase, upload_id, chunkIndex: i, token, durationSec,
      bytesUploaded, chunkSize, totalSize,
      onProgress,
    });

    uploadedChunks.push(i);
    bytesUploaded = result.total_received || (bytesUploaded + chunkSize);

    // Update progress
    const percent = Math.round((bytesUploaded / totalSize) * 100);
    onProgress(percent, bytesUploaded, totalSize);
    onChunkComplete(i, totalChunks);

    // Save state after each chunk
    await saveState(upload_id, {
      serverUrl: opts.serverUrl, totalSize, totalChunks,
      uploadedChunks, bytesUploaded,
    });
  }
}

/**
 * Upload a single chunk with retry logic (exponential backoff).
 */
async function uploadChunkWithRetry(chunkBlob, opts) {
  const { apiBase, upload_id, chunkIndex, token, durationSec, bytesUploaded, chunkSize, totalSize, onProgress } = opts;
  let lastError = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const result = await uploadSingleChunk(chunkBlob, {
        url: `${apiBase}/${upload_id}/chunk/${chunkIndex}`,
        token,
        durationSec,
        onChunkProgress: (loaded, total) => {
          const overallBytes = bytesUploaded + (chunkSize * (loaded / total));
          const overallPercent = Math.round((overallBytes / totalSize) * 100);
          onProgress(overallPercent, overallBytes, totalSize);
        },
      });

      if (result.success) return result;
      lastError = new Error(result.error || 'Chunk upload failed');
    } catch (err) {
      lastError = err;
    }

    // Exponential backoff before retry
    if (attempt < MAX_RETRIES - 1) {
      await sleep(RETRY_BASE_DELAY * Math.pow(2, attempt));
    }
  }

  throw lastError || new Error(`Max retries exceeded for chunk ${opts.chunkIndex}`);
}

/**
 * Upload a single chunk via XHR (supports progress tracking).
 */
function uploadSingleChunk(chunkBlob, { url, token, durationSec, onChunkProgress }) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && onChunkProgress) {
        onChunkProgress(e.loaded, e.total);
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          reject(new Error('Invalid JSON response'));
        }
      } else {
        reject(new Error(`HTTP ${xhr.status}: ${(xhr.responseText || '').slice(0, 200)}`));
      }
    });

    xhr.addEventListener('error', () => reject(new Error('Network error')));
    xhr.addEventListener('timeout', () => reject(new Error('Chunk upload timeout (30s)')));
    xhr.addEventListener('abort', () => reject(new Error('Upload aborted')));

    xhr.open('PUT', url);
    xhr.timeout = XHR_TIMEOUT;
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    if (durationSec) xhr.setRequestHeader('X-Recording-Duration', String(durationSec));

    xhr.send(chunkBlob);
  });
}

// --- Helpers ---

async function apiRequest(url, { method = 'GET', token, durationSec, body } = {}) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (token) opts.headers['Authorization'] = `Bearer ${token}`;
  if (durationSec) opts.headers['X-Recording-Duration'] = String(durationSec);
  if (body && method !== 'GET') opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);
  if (!res.ok) {
    let detail = '';
    try { detail = ': ' + (await res.text()).slice(0, 200); } catch {}
    throw new Error(`HTTP ${res.status}${detail}`);
  }
  return res.json();
}

async function saveState(uploadId, data) {
  try {
    await chrome.storage.local.set({
      [`chunked_upload_${uploadId}`]: { ...data, uploadId, lastUpdate: Date.now() },
    });
  } catch { /* ignore in non-extension context */ }
}

async function clearState(uploadId) {
  try {
    await chrome.storage.local.remove(`chunked_upload_${uploadId}`);
  } catch { /* ignore */ }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
