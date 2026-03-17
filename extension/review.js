/* review.js — Preview recorded video, upload with progress */

let SERVER_URL = '';
const content = document.getElementById('content');

let blobUrl = null;

(async function init() {
  const stored = await chrome.storage.local.get('serverUrl');
  SERVER_URL = stored.serverUrl || '';

  const data = await loadRecordingBlob();
  if (!data || !data.blob) {
    content.innerHTML = '<div class="empty"><p>Recording not found.<br>Record a video and try again.</p></div>';
    return;
  }

  const blob = data.blob;
  const sizeMB = (blob.size / 1048576).toFixed(1);
  blobUrl = URL.createObjectURL(blob);

  content.innerHTML = `
    <div class="player-card">
      <video id="video" controls src="${blobUrl}"></video>
      <div class="meta">
        <span>Size: <strong>${sizeMB} MB</strong></span>
        <span>Author: <strong>${data.author || 'unknown'}</strong></span>
      </div>
    </div>

    <div class="actions">
      <button class="btn btn-upload" id="btn-upload">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/></svg>
        Upload to Server
      </button>
      <button class="btn btn-discard" id="btn-discard">Discard</button>
    </div>

    <div class="progress-container" id="progress-container">
      <div class="progress-track"><div class="progress-fill" id="progress-fill"></div></div>
      <div class="progress-text" id="progress-text">0%</div>
    </div>

    <div class="status" id="status"></div>
  `;

  setupButtons();
})();

function setupButtons() {
  const btnUpload = document.getElementById('btn-upload');
  const btnDiscard = document.getElementById('btn-discard');
  const progressContainer = document.getElementById('progress-container');
  const progressFill = document.getElementById('progress-fill');
  const progressText = document.getElementById('progress-text');
  const statusEl = document.getElementById('status');

  btnUpload.addEventListener('click', async () => {
    btnUpload.disabled = true;
    btnDiscard.disabled = true;
    progressContainer.style.display = '';
    statusEl.textContent = 'Uploading...';
    statusEl.className = 'status';

    // Tell background to start upload (offscreen handles it)
    chrome.runtime.sendMessage({ type: 'start-upload' });
  });

  btnDiscard.addEventListener('click', async () => {
    if (!confirm('Discard this recording? It will be permanently deleted.')) return;
    btnUpload.disabled = true;
    btnDiscard.disabled = true;

    chrome.runtime.sendMessage({ type: 'discard-recording' });

    if (blobUrl) URL.revokeObjectURL(blobUrl);
    content.innerHTML = '<div class="empty"><p>Recording discarded.</p></div>';
  });

  // Listen for progress/done messages
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'upload-progress') {
      progressFill.style.width = msg.percent + '%';
      progressText.textContent = `${msg.percent}% (${(msg.loaded / 1048576).toFixed(1)} / ${(msg.total / 1048576).toFixed(1)} MB)`;
    }

    if (msg.type === 'upload-done') {
      progressFill.style.width = '100%';
      progressText.textContent = '100%';
      const url = `${SERVER_URL}/recording/${encodeURIComponent(msg.recordingId)}`;
      statusEl.innerHTML = `Uploaded! <a href="${url}" target="_blank">${msg.recordingId}</a> — processing started.`;
      statusEl.className = 'status success';

      if (blobUrl) URL.revokeObjectURL(blobUrl);

      // Can close tab after a moment
      btnUpload.style.display = 'none';
      btnDiscard.style.display = 'none';
    }

    if (msg.type === 'upload-error') {
      statusEl.textContent = 'Error: ' + (msg.error || 'Upload failed');
      statusEl.className = 'status error';
      btnUpload.disabled = false;
      btnDiscard.disabled = false;
    }
  });
}

// Cleanup blob URL when page unloads
window.addEventListener('beforeunload', () => {
  if (blobUrl) URL.revokeObjectURL(blobUrl);
});
