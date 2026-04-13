/* review.js — Preview recorded video with trim + cut controls, upload with progress */

const t = (key, fallback) => {
  try { return chrome.i18n?.getMessage(key) || fallback || key; }
  catch { return fallback || key; }
};

let SERVER_URL = '';
let DASHBOARD_PATH = '/'; // Overridden by branded builds (e.g. '/app/')
const content = document.getElementById('content');

let blobUrl = null;
let videoDuration = 0;
let trimStart = 0;
let trimEnd = 0;
let cuts = []; // [{start: number, end: number}, ...]
let previewInterval = null;

(async function init() {
  const stored = await chrome.storage.local.get('serverUrl');
  SERVER_URL = stored.serverUrl || '';

  // Retry a few times — blob may still be saving to IDB when review page opens
  let data = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    data = await loadRecordingBlob();
    if (data && data.blob) break;
    await new Promise(r => setTimeout(r, 500));
  }
  if (!data || !data.blob) {
    content.innerHTML = `<div class="empty"><p>${t('review_notFound', 'Recording not found.')}<br>${t('review_notFoundHint', 'Record a video and try again.')}</p></div>`;
    return;
  }

  const blob = data.blob;
  const sizeMB = (blob.size / 1048576).toFixed(1);
  blobUrl = URL.createObjectURL(blob);

  content.innerHTML = `
    <div class="player-card">
      <video id="video" controls src="${blobUrl}"></video>
      <div class="meta">
        <span>${t('review_size', 'Size')}: <strong>${sizeMB} MB</strong></span>
        <span>${t('review_author', 'Author')}: <strong>${data.author || t('review_unknown', 'unknown')}</strong></span>
        <span id="meta-duration">${t('review_duration', 'Duration')}: <strong>...</strong></span>
      </div>
    </div>

    <div class="trim-section" id="trim-section">
      <div class="trim-header">
        <span>${t('review_trimAndCut', 'Trim & Cut')}</span>
        <div class="trim-times">
          <span class="time-badge" id="trim-start-label">0:00</span>
          <span style="color:#475569;">&mdash;</span>
          <span class="time-badge" id="trim-end-label">0:00</span>
        </div>
      </div>
      <div class="trim-track-wrapper" id="trim-track-wrapper">
        <div class="trim-track"></div>
        <div class="trim-range" id="trim-range"></div>
        <div id="cuts-container"></div>
        <div class="playhead" id="playhead"></div>
        <div class="trim-handle" id="trim-handle-start" data-handle="start"></div>
        <div class="trim-handle" id="trim-handle-end" data-handle="end"></div>
      </div>
      <div class="trim-actions">
        <button class="btn-sm btn-preview" id="btn-preview">${t('review_preview', 'Preview')}</button>
        <button class="btn-sm btn-reset" id="btn-reset">${t('review_reset', 'Reset')}</button>
        <button class="btn-sm btn-add-cut" id="btn-add-cut">&#9986; ${t('review_cut', 'Cut')}</button>
        <span class="trim-info" id="trim-info">${t('review_fullVideo', 'Full video')}</span>
      </div>
      <div class="cuts-list" id="cuts-list"></div>
    </div>

    <div class="actions">
      <button class="btn btn-upload" id="btn-upload">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/></svg>
        ${t('review_btnUpload', 'Upload to Server')}
      </button>
      <button class="btn btn-discard" id="btn-discard">${t('review_btnDiscard', 'Discard')}</button>
    </div>

    <div class="progress-container" id="progress-container">
      <div class="progress-track"><div class="progress-fill" id="progress-fill"></div></div>
      <div class="progress-text" id="progress-text">0%</div>
      <div class="upload-controls hidden" id="upload-controls" style="gap:8px; justify-content:center; margin-top:10px;">
        <button class="btn-sm btn-preview" id="btn-upload-pause">${t('review_pauseUpload', 'Пауза')}</button>
        <button class="btn-sm btn-preview hidden" id="btn-upload-resume">${t('review_resumeUpload', 'Продолжить')}</button>
        <button class="btn-sm btn-reset" id="btn-upload-cancel">${t('review_cancelUpload', 'Отмена')}</button>
      </div>
    </div>

    <div class="status" id="status"></div>
  `;

  const video = document.getElementById('video');
  video.addEventListener('loadedmetadata', () => {
    if (isFinite(video.duration) && video.duration > 0) {
      videoDuration = video.duration;
      trimEnd = videoDuration;
      document.getElementById('meta-duration').innerHTML = `${t('review_duration', 'Duration')}: <strong>${formatTime(videoDuration)}</strong>`;
      updateUI();
    } else {
      // WebM from MediaRecorder lacks duration header — force browser to discover it
      video.currentTime = 1e101;
    }
  });

  // Fallback for WebM without duration header
  video.addEventListener('durationchange', () => {
    if (video.duration && isFinite(video.duration) && video.duration !== videoDuration) {
      const needsReset = videoDuration === 0;
      videoDuration = video.duration;
      trimEnd = videoDuration;
      document.getElementById('meta-duration').innerHTML = `${t('review_duration', 'Duration')}: <strong>${formatTime(videoDuration)}</strong>`;
      updateUI();
      // Reset playhead after forced duration discovery
      if (needsReset) {
        video.currentTime = 0;
      }
    }
  });

  // Sync playhead on trim track with video position
  video.addEventListener('timeupdate', () => {
    const ph = document.getElementById('playhead');
    if (ph && videoDuration) {
      ph.style.left = (video.currentTime / videoDuration) * 100 + '%';
    }
  });

  setupHandles();
  setupButtons();
})();

/* --- Handle dragging (trim + cut) --- */

function setupHandles() {
  const wrapper = document.getElementById('trim-track-wrapper');
  if (!wrapper) return;

  let active = null; // {type: 'trim-start'|'trim-end'|'cut-start'|'cut-end', cutIdx?: number}

  function onPointerDown(e) {
    const cutHandle = e.target.closest('.cut-handle');
    if (cutHandle) {
      active = { type: 'cut-' + cutHandle.dataset.side, cutIdx: parseInt(cutHandle.dataset.cutIdx) };
      cutHandle.classList.add('dragging');
      e.preventDefault();
      return;
    }
    const trimHandle = e.target.closest('.trim-handle');
    if (trimHandle) {
      active = { type: trimHandle.dataset.handle === 'start' ? 'trim-start' : 'trim-end' };
      trimHandle.classList.add('dragging');
      e.preventDefault();
      return;
    }
    // Click on track (not on a handle) → seek video to that position
    if (videoDuration && (e.target.closest('.trim-track') || e.target.closest('.trim-range') || e.target.closest('.cut-zone'))) {
      const rect = wrapper.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const video = document.getElementById('video');
      if (video) video.currentTime = ratio * videoDuration;
    }
  }

  function onPointerMove(e) {
    if (!active || !videoDuration) return;
    const rect = wrapper.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const time = ratio * videoDuration;

    if (active.type === 'trim-start') {
      trimStart = Math.max(0, Math.min(time, trimEnd - 0.5));
      constrainCuts();
    } else if (active.type === 'trim-end') {
      trimEnd = Math.min(videoDuration, Math.max(time, trimStart + 0.5));
      constrainCuts();
    } else if (active.type === 'cut-start') {
      const cut = cuts[active.cutIdx];
      if (cut) cut.start = Math.max(trimStart, Math.min(time, cut.end - 0.3));
    } else if (active.type === 'cut-end') {
      const cut = cuts[active.cutIdx];
      if (cut) cut.end = Math.min(trimEnd, Math.max(time, cut.start + 0.3));
    }
    updateUI();
  }

  function onPointerUp() {
    if (active) {
      document.querySelectorAll('.trim-handle, .cut-handle').forEach(h => h.classList.remove('dragging'));
      active = null;
    }
  }

  wrapper.addEventListener('pointerdown', onPointerDown);
  document.addEventListener('pointermove', onPointerMove);
  document.addEventListener('pointerup', onPointerUp);
}

function constrainCuts() {
  cuts = cuts.filter(c => c.end > trimStart && c.start < trimEnd)
    .map(c => ({ start: Math.max(trimStart, c.start), end: Math.min(trimEnd, c.end) }))
    .filter(c => c.end - c.start >= 0.3);
}

/* --- Add / remove cuts --- */

function addCut() {
  if (!videoDuration) return;
  const video = document.getElementById('video');
  const pos = video ? video.currentTime : (trimStart + trimEnd) / 2;

  // Default: 2 seconds centered on current position, at least 10% of trim range
  const halfWidth = Math.min(1, (trimEnd - trimStart) * 0.1);
  let cutStart = Math.max(trimStart + 0.3, pos - halfWidth);
  let cutEnd = Math.min(trimEnd - 0.3, pos + halfWidth);
  if (cutEnd - cutStart < 0.3) return;

  cuts.push({ start: cutStart, end: cutEnd });
  cuts.sort((a, b) => a.start - b.start);
  updateUI();
}

function removeCut(idx) {
  cuts.splice(idx, 1);
  updateUI();
}

/* --- Compute segments to keep (trim range minus cuts) --- */

function computeSegments() {
  let segments = [{ start: trimStart, end: trimEnd }];
  const sorted = [...cuts].sort((a, b) => a.start - b.start);

  for (const cut of sorted) {
    const next = [];
    for (const seg of segments) {
      if (cut.end <= seg.start || cut.start >= seg.end) {
        next.push(seg);
      } else {
        if (seg.start < cut.start - 0.05) next.push({ start: seg.start, end: cut.start });
        if (cut.end < seg.end - 0.05) next.push({ start: cut.end, end: seg.end });
      }
    }
    segments = next;
  }
  return segments.filter(s => s.end - s.start >= 0.1);
}

/* --- UI update --- */

function updateUI() {
  if (!videoDuration) return;

  const startPct = (trimStart / videoDuration) * 100;
  const endPct = (trimEnd / videoDuration) * 100;

  const range = document.getElementById('trim-range');
  const handleStart = document.getElementById('trim-handle-start');
  const handleEnd = document.getElementById('trim-handle-end');
  const startLabel = document.getElementById('trim-start-label');
  const endLabel = document.getElementById('trim-end-label');
  const info = document.getElementById('trim-info');
  const cutsContainer = document.getElementById('cuts-container');
  const cutsList = document.getElementById('cuts-list');

  if (range) { range.style.left = startPct + '%'; range.style.width = (endPct - startPct) + '%'; }
  if (handleStart) handleStart.style.left = startPct + '%';
  if (handleEnd) handleEnd.style.left = endPct + '%';
  if (startLabel) startLabel.textContent = formatTime(trimStart);
  if (endLabel) endLabel.textContent = formatTime(trimEnd);

  // Render cut zones on track
  if (cutsContainer) {
    cutsContainer.innerHTML = cuts.map((c, i) => {
      const cStartPct = (c.start / videoDuration) * 100;
      const cEndPct = (c.end / videoDuration) * 100;
      return `<div class="cut-zone" style="left:${cStartPct}%;width:${cEndPct - cStartPct}%"></div>` +
        `<div class="cut-handle" data-cut-idx="${i}" data-side="start" style="left:${cStartPct}%"></div>` +
        `<div class="cut-handle" data-cut-idx="${i}" data-side="end" style="left:${cEndPct}%"></div>`;
    }).join('');
  }

  // Render cuts list
  if (cutsList) {
    if (cuts.length > 0) {
      cutsList.innerHTML = cuts.map((c, i) =>
        `<div class="cut-item">` +
          `<span class="cut-item-time">${formatTime(c.start)} &mdash; ${formatTime(c.end)}</span>` +
          `<span class="cut-item-dur">${formatTime(c.end - c.start)}</span>` +
          `<button class="cut-item-remove" data-cut-idx="${i}">&times;</button>` +
        `</div>`
      ).join('');
      cutsList.querySelectorAll('.cut-item-remove').forEach(btn => {
        btn.addEventListener('click', () => removeCut(parseInt(btn.dataset.cutIdx)));
      });
    } else {
      cutsList.innerHTML = '';
    }
  }

  // Info text
  const segments = computeSegments();
  const keepDur = segments.reduce((sum, s) => sum + (s.end - s.start), 0);
  const isFull = segments.length === 1 && segments[0].start < 0.1 && (videoDuration - segments[0].end) < 0.1;

  if (info) {
    info.textContent = isFull
      ? t('review_fullVideo', 'Full video')
      : `${t('review_result', 'Result')}: ${formatTime(keepDur)} (${Math.round((keepDur / videoDuration) * 100)}%)`;
  }
}

/* --- Buttons --- */

function setupButtons() {
  const btnUpload = document.getElementById('btn-upload');
  const btnDiscard = document.getElementById('btn-discard');
  const btnPreview = document.getElementById('btn-preview');
  const btnReset = document.getElementById('btn-reset');
  const btnAddCut = document.getElementById('btn-add-cut');
  const progressContainer = document.getElementById('progress-container');
  const progressFill = document.getElementById('progress-fill');
  const progressText = document.getElementById('progress-text');
  const statusEl = document.getElementById('status');
  const uploadControls = document.getElementById('upload-controls');
  const btnUploadPause = document.getElementById('btn-upload-pause');
  const btnUploadResume = document.getElementById('btn-upload-resume');
  const btnUploadCancel = document.getElementById('btn-upload-cancel');

  btnUploadPause.addEventListener('click', () => {
    btnUploadPause.disabled = true;
    chrome.runtime.sendMessage({ type: 'upload-pause' });
  });
  btnUploadResume.addEventListener('click', () => {
    btnUploadResume.disabled = true;
    chrome.runtime.sendMessage({ type: 'upload-resume' });
  });
  btnUploadCancel.addEventListener('click', () => {
    if (!confirm(t('review_confirmCancelUpload', 'Отменить загрузку? Часть уже загруженных данных будет потеряна.'))) return;
    btnUploadCancel.disabled = true;
    btnUploadPause.disabled = true;
    btnUploadResume.disabled = true;
    chrome.runtime.sendMessage({ type: 'upload-cancel' });
  });

  // Add cut
  btnAddCut.addEventListener('click', () => addCut());

  // Preview — plays kept segments, skips cut regions
  btnPreview.addEventListener('click', () => {
    const video = document.getElementById('video');
    if (!video) return;
    stopPreview();

    const segments = computeSegments();
    if (!segments.length) return;

    let segIdx = 0;
    video.currentTime = segments[0].start;
    video.play();

    previewInterval = setInterval(() => {
      const seg = segments[segIdx];
      if (!seg || video.currentTime >= seg.end - 0.1) {
        segIdx++;
        if (segIdx < segments.length) {
          video.currentTime = segments[segIdx].start;
        } else {
          video.pause();
          stopPreview();
        }
      }
    }, 100);

    btnPreview.textContent = t('review_previewing', 'Previewing...');
    btnPreview.disabled = true;
    video.addEventListener('pause', () => {
      stopPreview();
      btnPreview.textContent = t('review_preview', 'Preview');
      btnPreview.disabled = false;
    }, { once: true });
  });

  // Reset
  btnReset.addEventListener('click', () => {
    trimStart = 0;
    trimEnd = videoDuration;
    cuts = [];
    updateUI();
  });

  // Upload
  btnUpload.addEventListener('click', async () => {
    btnUpload.disabled = true;
    btnDiscard.disabled = true;
    progressContainer.style.display = 'block';
    statusEl.textContent = t('review_uploading', 'Uploading... Link will be copied to clipboard when done.');
    statusEl.className = 'status';

    const segments = computeSegments();
    const isFull = segments.length === 1 && segments[0].start < 0.1 && (videoDuration - segments[0].end) < 0.1;

    const msg = { type: 'start-upload' };
    if (!isFull) {
      msg.segments = segments.map(s => ({
        start: Math.round(s.start * 10) / 10,
        end: Math.round(s.end * 10) / 10
      }));
    }
    chrome.runtime.sendMessage(msg, (response) => {
      const err = chrome.runtime.lastError;
      if (err || (response && !response.success)) {
        statusEl.textContent = t('error_generic', 'Error') + ': ' + (err?.message || response?.error || t('error_upload_failed', 'Upload failed'));
        statusEl.className = 'status error';
        btnUpload.disabled = false;
        btnDiscard.disabled = false;
        progressContainer.style.display = 'none';
      }
    });
  });

  // Discard
  btnDiscard.addEventListener('click', async () => {
    if (!confirm(t('review_confirmDiscard', 'Discard this recording? It will be permanently deleted.'))) return;
    btnUpload.disabled = true;
    btnDiscard.disabled = true;

    chrome.runtime.sendMessage({ type: 'discard-recording' });

    if (blobUrl) URL.revokeObjectURL(blobUrl);
    content.innerHTML = `<div class="empty"><p>${t('review_discarded', 'Recording discarded.')}</p></div>`;
  });

  // Listen for progress/done messages
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'upload-chunked-started') {
      uploadControls.classList.remove('hidden');
    }

    if (msg.type === 'upload-pause-state') {
      if (msg.paused) {
        btnUploadPause.classList.add('hidden');
        btnUploadResume.classList.remove('hidden');
        btnUploadResume.disabled = false;
        statusEl.textContent = t('review_uploadPaused', 'Загрузка на паузе — нажмите «Продолжить»');
        statusEl.className = 'status';
      } else {
        btnUploadResume.classList.add('hidden');
        btnUploadPause.classList.remove('hidden');
        btnUploadPause.disabled = false;
        statusEl.textContent = t('review_uploading', 'Загрузка... Ссылка будет скопирована по завершении.');
        statusEl.className = 'status';
      }
    }

    if (msg.type === 'upload-cancelled') {
      progressContainer.style.display = 'none';
      uploadControls.classList.add('hidden');
      statusEl.textContent = t('review_uploadCancelled', 'Загрузка отменена. Запись удалена.');
      statusEl.className = 'status';
      btnUpload.disabled = true;
      btnDiscard.disabled = true;
      btnUpload.style.display = 'none';
      btnDiscard.style.display = 'none';
      document.getElementById('trim-section').style.display = 'none';
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    }

    if (msg.type === 'upload-progress') {
      progressFill.style.width = msg.percent + '%';
      progressText.textContent = `${msg.percent}% (${(msg.loaded / 1048576).toFixed(1)} / ${(msg.total / 1048576).toFixed(1)} MB)`;
    }

    if (msg.type === 'upload-done') {
      progressFill.style.width = '100%';
      progressText.textContent = '100%';
      uploadControls.classList.add('hidden');
      const url = `${SERVER_URL}${DASHBOARD_PATH}recording/${encodeURIComponent(msg.recordingId)}`;

      // Auto-copy link to clipboard
      navigator.clipboard.writeText(url).catch(() => {});

      // Show prominent link with copy button
      statusEl.innerHTML = `
        <div style="margin-top:12px;padding:16px;background:#0f2a1f;border:1px solid #22c55e;border-radius:10px;text-align:center;">
          <div style="font-size:13px;color:#22c55e;font-weight:600;margin-bottom:8px;">${t('review_uploadDone', 'Video uploaded — link copied to clipboard')}</div>
          <a href="${url}" target="_blank" style="font-size:15px;color:#3b82f6;font-weight:700;word-break:break-all;">${url}</a>
          <div style="margin-top:10px;">
            <button id="btn-copy-link" style="padding:8px 20px;background:#334155;border:1px solid #475569;border-radius:6px;color:#e2e8f0;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;">${t('review_copyLink', 'Copy link')}</button>
          </div>
        </div>`;
      statusEl.className = 'status';

      document.getElementById('btn-copy-link')?.addEventListener('click', () => {
        navigator.clipboard.writeText(url).then(() => {
          document.getElementById('btn-copy-link').textContent = t('review_copied', 'Copied!');
          setTimeout(() => { document.getElementById('btn-copy-link').textContent = t('review_copyLink', 'Copy link'); }, 2000);
        });
      });

      if (blobUrl) URL.revokeObjectURL(blobUrl);

      btnUpload.style.display = 'none';
      btnDiscard.style.display = 'none';
      document.getElementById('trim-section').style.display = 'none';
    }

    if (msg.type === 'upload-error') {
      statusEl.textContent = t('error_generic', 'Error') + ': ' + (msg.error || t('error_upload_failed', 'Upload failed'));
      statusEl.className = 'status error';
      btnUpload.disabled = false;
      btnDiscard.disabled = false;
      uploadControls.classList.add('hidden');
    }
  });
}

function stopPreview() {
  if (previewInterval) { clearInterval(previewInterval); previewInterval = null; }
}

/* --- Helpers --- */

function formatTime(sec) {
  if (!sec || !isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Cleanup blob URL when page unloads
window.addEventListener('beforeunload', () => {
  stopPreview();
  if (blobUrl) URL.revokeObjectURL(blobUrl);
});
