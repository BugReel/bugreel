/**
 * BugReel — In-browser screen recorder (chunk A+B+C)
 *
 * Finite state machine:
 *   idle → requesting → recording ↔ paused → stopping → preview → uploading → (redirect /share/:token)
 *                                                       ↘ error
 *
 * Chunk C wires the Save button to chunkedUploadFromPage() in page-uploader.js
 * and shows a progress panel while the upload runs.
 */

import { chunkedUploadFromPage } from './page-uploader.js';

/* ── i18n helper ──────────────────────────────────────────────────────────── */
const t = window.__dashboardI18n?.t || ((k, f) => f || k);

/* ── State machine ────────────────────────────────────────────────────────── */
/** @type {'idle'|'requesting'|'recording'|'paused'|'stopping'|'preview'|'uploading'|'error'} */
let state = 'idle';

/* ── Recording state ──────────────────────────────────────────────────────── */
let mediaStream   = null;   // MediaStream from getDisplayMedia
let mediaRecorder = null;   // MediaRecorder instance
let chunks        = [];     // Blob chunks collected via ondataavailable
let recordingBlob = null;   // Final Blob (set in finalizeRecording; kept until redirect/discard)
let blobUrl       = null;   // Object URL for the preview <video>

/* ── Timer state (performance.now() deltas, freezes on pause) ────────────── */
let timerStart    = 0;      // performance.now() when last (re)started
let timerAccum    = 0;      // ms accumulated before current segment
let timerRaf      = null;   // requestAnimationFrame handle

/* ── DOM refs ─────────────────────────────────────────────────────────────── */
const $ = id => document.getElementById(id);

const panels = {
  idle:       $('rec-panel-idle'),
  requesting: $('rec-panel-requesting'),
  recording:  $('rec-panel-recording'),
  preview:    $('rec-panel-preview'),
  uploading:  $('rec-panel-uploading'),
  error:      $('rec-panel-error'),
};

const btnStart        = $('rec-btn-start');
const btnPause        = $('rec-btn-pause');
const btnResume       = $('rec-btn-resume');
const btnStop         = $('rec-btn-stop');
const btnSave         = $('rec-btn-save');
const btnDiscard      = $('rec-btn-discard');
const btnErrBack      = $('rec-btn-error-back');
const btnRetryUpload  = $('rec-btn-retry-upload');
const btnCopyLink     = $('rec-btn-copy-link');

const liveVideo       = $('rec-live-video');
const previewVideo    = $('rec-preview-video');
const timerEl         = $('rec-timer');
const dotEl           = $('rec-dot');
const previewMeta     = $('rec-preview-meta');
const errHeading      = $('rec-error-heading');
const errMsg          = $('rec-error-msg');
const progressBar     = $('rec-progress-bar');
const progressText    = $('rec-progress-text');
const doneLinkRow     = $('rec-done-link-row');
const doneLinkInput   = $('rec-done-link-input');

/* ── Supported MIME type (copied from extension/recorder.js getSupportedMimeType) ── */
function pickMime() {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  for (const mime of candidates) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return 'video/webm'; // last-resort fallback (browser may still reject)
}

/* ── Panel switcher ───────────────────────────────────────────────────────── */
function showPanel(name) {
  Object.entries(panels).forEach(([key, el]) => {
    if (!el) return;
    el.classList.toggle('active', key === name);
  });
  state = name;
}

/* ── Timer helpers ────────────────────────────────────────────────────────── */
function formatTime(ms) {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60).toString().padStart(2, '0');
  const s = (totalSec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function tickTimer() {
  if (state !== 'recording') return;
  const elapsed = timerAccum + (performance.now() - timerStart);
  if (timerEl) timerEl.textContent = formatTime(elapsed);
  timerRaf = requestAnimationFrame(tickTimer);
}

function startTimer() {
  timerStart = performance.now();
  timerRaf = requestAnimationFrame(tickTimer);
}

function pauseTimer() {
  timerAccum += performance.now() - timerStart;
  if (timerRaf) { cancelAnimationFrame(timerRaf); timerRaf = null; }
}

function resetTimer() {
  timerAccum = 0;
  timerStart = 0;
  if (timerRaf) { cancelAnimationFrame(timerRaf); timerRaf = null; }
  if (timerEl) timerEl.textContent = '00:00';
}

/**
 * Duration of the last recording in seconds (rounded).
 * Reads the frozen timerAccum that pauseTimer() left when stopRecording() ran.
 */
function getRecordedDurationSec() {
  return Math.round(timerAccum / 1000);
}

/* ── Cleanup helpers ──────────────────────────────────────────────────────── */
function releaseTracks() {
  if (mediaStream) {
    mediaStream.getTracks().forEach(track => track.stop());
    mediaStream = null;
  }
  if (liveVideo) liveVideo.srcObject = null;
}

function revokeBlobUrl() {
  if (blobUrl) { URL.revokeObjectURL(blobUrl); blobUrl = null; }
  if (previewVideo) previewVideo.src = '';
}

/* ── Error panel ──────────────────────────────────────────────────────────── */
/**
 * @param {string}  heading
 * @param {string}  msg
 * @param {boolean} [showRetry=false]  Show "Retry upload" button (upload errors)
 */
function showError(heading, msg, showRetry = false) {
  if (errHeading) errHeading.textContent = heading;
  if (errMsg)     errMsg.textContent     = msg;
  if (btnRetryUpload) btnRetryUpload.style.display = showRetry ? '' : 'none';
  showPanel('error');
}

/* ── Stop recording → build blob → show preview ──────────────────────────── */
function finalizeRecording() {
  releaseTracks();
  resetTimer();

  const mimeType = mediaRecorder?.mimeType || 'video/webm';
  recordingBlob = new Blob(chunks, { type: mimeType });
  chunks = [];

  blobUrl = URL.createObjectURL(recordingBlob);

  if (previewVideo) {
    previewVideo.src = blobUrl;
    previewVideo.load();
  }

  if (previewMeta) {
    const sizeMB = (recordingBlob.size / (1024 * 1024)).toFixed(2);
    previewMeta.textContent = `${sizeMB} MB · ${mimeType}`;
  }

  showPanel('preview');
}

/* ── Upload flow ──────────────────────────────────────────────────────────── */

function setProgress(percent) {
  const pct = Math.min(100, Math.max(0, Math.round(percent)));
  if (progressBar)  progressBar.style.width = `${pct}%`;
  if (progressText) progressText.textContent = `${pct}%`;
}

async function startUpload() {
  if (!recordingBlob) return;

  // Move to uploading panel
  showPanel('uploading');
  setProgress(0);
  if (doneLinkRow) doneLinkRow.style.display = 'none';

  const durationSec = getRecordedDurationSec();

  try {
    const result = await chunkedUploadFromPage(recordingBlob, {
      durationSec,
      onProgress: (percent) => setProgress(percent),
    });

    // Ensure progress bar shows 100% before redirect
    setProgress(100);

    const shareToken = result.share_token;
    const shareUrl   = `${window.location.origin}/share/${shareToken}`;

    // Show copyable link as fallback before redirect fires
    if (doneLinkInput) doneLinkInput.value = shareUrl;
    if (doneLinkRow)   doneLinkRow.style.display = '';
    if (progressText)  progressText.textContent  = t('rec_done', 'Done! Redirecting…');

    // Release blob memory — upload is complete, we no longer need it
    revokeBlobUrl();
    recordingBlob = null;

    // Redirect after a short pause so the user sees the link
    setTimeout(() => {
      window.location.href = shareUrl;
    }, 1500);

  } catch (err) {
    console.error('[recorder-page] upload error:', err);
    showError(
      t('rec_err_upload', 'Upload failed'),
      err.message || t('rec_err_upload', 'Upload failed'),
      true, // showRetry
    );
  }
}

/* ── Wiring: track "ended" fires when user clicks "Stop sharing" in browser bar ── */
function attachTrackEndedListener(stream) {
  const videoTrack = stream.getVideoTracks()[0];
  if (!videoTrack) return;
  videoTrack.addEventListener('ended', () => {
    if (state === 'recording' || state === 'paused') {
      stopRecording();
    }
  });
}

/* ── Core actions ─────────────────────────────────────────────────────────── */
async function startRecording() {
  // Browser support gate: Safari doesn't support video/webm
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported('video/webm')) {
    showError(
      t('rec_err_unsupported_heading', 'Browser not supported'),
      t('rec_err_unsupported', 'Your browser does not support WebM recording. Please use Chrome or Firefox.')
    );
    return;
  }

  showPanel('requesting');
  chunks = [];

  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
  } catch (err) {
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      showError(
        t('rec_err_denied_heading', 'Access denied'),
        t('rec_err_denied', 'Screen access was denied. Please click "Start recording" and allow screen sharing when prompted.')
      );
    } else {
      // Other errors (e.g. AbortError when user just closes dialog without choosing)
      showPanel('idle');
    }
    return;
  }

  mediaStream = stream;
  attachTrackEndedListener(stream);

  // Live preview
  if (liveVideo) {
    liveVideo.srcObject = stream;
    // autoplay attribute on the element handles playback
  }

  const mimeType = pickMime();
  try {
    mediaRecorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 1_500_000,
    });
  } catch (err) {
    releaseTracks();
    showError(
      t('rec_err_unsupported_heading', 'Browser not supported'),
      t('rec_err_unsupported', 'Your browser does not support WebM recording. Please use Chrome or Firefox.')
    );
    return;
  }

  mediaRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  mediaRecorder.onstop = () => {
    finalizeRecording();
  };

  // timeslice: collect a chunk every 4 seconds so we don't hold everything in RAM
  mediaRecorder.start(4000);

  // Update UI
  if (dotEl) { dotEl.className = 'rec-dot recording'; }
  if (btnPause)  btnPause.style.display  = '';
  if (btnResume) btnResume.style.display = 'none';

  showPanel('recording');
  startTimer();
}

function pauseRecording() {
  if (state !== 'recording' || !mediaRecorder) return;
  mediaRecorder.pause();
  pauseTimer();
  state = 'paused'; // keep same panel, just update dot + buttons

  if (dotEl)    { dotEl.className = 'rec-dot paused'; }
  if (btnPause)  btnPause.style.display  = 'none';
  if (btnResume) btnResume.style.display = '';
}

function resumeRecording() {
  if (state !== 'paused' || !mediaRecorder) return;
  mediaRecorder.resume();
  state = 'recording';

  if (dotEl)    { dotEl.className = 'rec-dot recording'; }
  if (btnPause)  btnPause.style.display  = '';
  if (btnResume) btnResume.style.display = 'none';

  startTimer();
}

function stopRecording() {
  if (!mediaRecorder) return;
  if (state === 'paused') {
    // Resume first so onstop fires correctly in all browsers
    mediaRecorder.resume();
  }
  pauseTimer(); // freeze the displayed time — getRecordedDurationSec() reads this
  mediaRecorder.stop();
  // onstop → finalizeRecording → showPanel('preview')
}

function discardRecording() {
  revokeBlobUrl();
  recordingBlob = null;
  releaseTracks();
  resetTimer();
  chunks = [];
  mediaRecorder = null;
  showPanel('idle');
}

/* ── Beforeunload guard ───────────────────────────────────────────────────── */
window.addEventListener('beforeunload', (e) => {
  if (state === 'recording' || state === 'paused' || state === 'uploading') {
    e.preventDefault();
    // Modern browsers show a generic warning; setting returnValue triggers it
    e.returnValue = '';
  }
});

/* ── Button event listeners ───────────────────────────────────────────────── */
if (btnStart)       btnStart.addEventListener('click',       startRecording);
if (btnPause)       btnPause.addEventListener('click',       pauseRecording);
if (btnResume)      btnResume.addEventListener('click',      resumeRecording);
if (btnStop)        btnStop.addEventListener('click',        stopRecording);
if (btnSave)        btnSave.addEventListener('click',        startUpload);
if (btnDiscard)     btnDiscard.addEventListener('click',     discardRecording);
if (btnErrBack)     btnErrBack.addEventListener('click',     () => showPanel('idle'));
if (btnRetryUpload) btnRetryUpload.addEventListener('click', startUpload);

if (btnCopyLink) {
  btnCopyLink.addEventListener('click', () => {
    if (!doneLinkInput) return;
    doneLinkInput.select();
    navigator.clipboard?.writeText(doneLinkInput.value).catch(() => {
      // Fallback: execCommand is deprecated but works in older browsers
      document.execCommand('copy');
    });
    const span = btnCopyLink.querySelector('span');
    if (span) {
      const prev = span.textContent;
      span.textContent = t('rec_copied', 'Copied!');
      setTimeout(() => { span.textContent = prev; }, 1500);
    }
  });
}

/* ── Initial state ────────────────────────────────────────────────────────── */
showPanel('idle');
