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
import { getCurrentUserAsync } from './shared.js';

/* ── i18n helper ──────────────────────────────────────────────────────────── */
const t = window.__dashboardI18n?.t || ((k, f) => f || k);

/* ── State machine ────────────────────────────────────────────────────────── */
/** @type {'idle'|'requesting'|'recording'|'paused'|'stopping'|'preview'|'uploading'|'done'|'error'} */
let state = 'idle';

/* ── Recording state ──────────────────────────────────────────────────────── */
let mediaStream   = null;   // MediaStream from getDisplayMedia
let mediaRecorder = null;   // MediaRecorder instance
let chunks        = [];     // Blob chunks collected via ondataavailable
let recordingBlob = null;   // Final Blob (set in finalizeRecording; kept until redirect/discard)
let blobUrl       = null;   // Object URL for the preview <video>
let pendingShareUrl = null; // Share URL held back behind the guest claim gate

/* ── Audio capture state ──────────────────────────────────────────────────── */
let micStream       = null; // getUserMedia mic stream (mixed into the recording)
let audioContext    = null; // AudioContext used to mix mic + system audio
let micLevelCtx     = null; // separate AudioContext driving the live mic meter
let micLevelAnalyser= null;
let micLevelRaf     = null; // rAF handle for the in-recording mic meter
let micTestStream   = null; // getUserMedia stream for the pre-flight mic test
let micTestCtx      = null;
let micTestRaf      = null;
let hasMicTrack       = false; // mic actually captured this session
let hasSystemAudioTrack = false; // system/tab audio actually captured this session

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
const claimRow        = $('rec-claim-row');
const claimForm       = $('rec-claim-form');
const claimEmail      = $('rec-claim-email');
const claimSubmit     = $('rec-claim-submit');
const claimMsg        = $('rec-claim-msg');

const optMic          = $('rec-opt-mic');
const micTestBtn      = $('rec-mic-test');
const micMeter        = $('rec-mic-meter');
const micMeterBar     = $('rec-mic-meter-bar');
const idleMsg         = $('rec-idle-msg');
const chipMic         = $('rec-chip-mic');
const chipSysAudio    = $('rec-chip-sysaudio');
const micLiveBar      = $('rec-mic-live-bar');

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
  stopMicLevelMonitor();
  if (mediaStream) {
    mediaStream.getTracks().forEach(track => track.stop());
    mediaStream = null;
  }
  if (micStream) {
    micStream.getTracks().forEach(track => track.stop());
    micStream = null;
  }
  if (audioContext) { audioContext.close().catch(() => {}); audioContext = null; }
  if (liveVideo) liveVideo.srcObject = null;
}

function revokeBlobUrl() {
  if (blobUrl) { URL.revokeObjectURL(blobUrl); blobUrl = null; }
  if (previewVideo) previewVideo.src = '';
}

/* ── Audio: mic capture, mixing, live level meters ────────────────────────── */

// Average frequency energy → 0..100 level. Mirrors the extension's mic meter.
function computeLevel(analyser, dataArray) {
  analyser.getByteFrequencyData(dataArray);
  let sum = 0;
  for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
  return Math.min(100, Math.round((sum / dataArray.length) * 1.5));
}

/* Pre-flight mic test (idle panel) — lets the user confirm the mic picks up
   sound BEFORE starting a recording. Toggles on/off. */
function setMicTestLabel(testing) {
  const span = micTestBtn?.querySelector('span');
  if (span) span.textContent = testing
    ? t('rec_mic_test_stop', 'Stop test')
    : t('rec_mic_test', 'Test mic');
}

async function toggleMicTest() {
  if (micTestStream) { stopMicTest(); return; }
  if (idleMsg) idleMsg.style.display = 'none';
  try {
    micTestStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (_) {
    if (idleMsg) {
      idleMsg.textContent = t('rec_mic_denied', 'Microphone unavailable — the recording will have no voice-over.');
      idleMsg.style.display = '';
    }
    return;
  }
  try {
    micTestCtx = new AudioContext();
    const analyser = micTestCtx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.5;
    micTestCtx.createMediaStreamSource(micTestStream).connect(analyser);
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    if (micMeter) micMeter.style.display = '';
    const loop = () => {
      if (micMeterBar) micMeterBar.style.width = computeLevel(analyser, dataArray) + '%';
      micTestRaf = requestAnimationFrame(loop);
    };
    loop();
    setMicTestLabel(true);
  } catch (_) {
    stopMicTest();
  }
}

function stopMicTest() {
  if (micTestRaf) { cancelAnimationFrame(micTestRaf); micTestRaf = null; }
  if (micTestStream) { micTestStream.getTracks().forEach(tr => tr.stop()); micTestStream = null; }
  if (micTestCtx) { micTestCtx.close().catch(() => {}); micTestCtx = null; }
  if (micMeterBar) micMeterBar.style.width = '0%';
  if (micMeter) micMeter.style.display = 'none';
  setMicTestLabel(false);
}

/* Build the recording stream: screen video + (mic and/or system audio).
   getDisplayMedia({audio:true}) only yields SYSTEM/tab audio — the microphone
   must be captured separately via getUserMedia and mixed in. */
async function buildRecordStream(displayStream) {
  const wantMic = optMic ? optMic.checked : true;
  micStream = null;
  if (wantMic) {
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (_) {
      micStream = null; // denied / no device — record without voice-over
    }
  }

  const captureHasAudio = displayStream.getAudioTracks().length > 0;
  hasMicTrack = !!(micStream && micStream.getAudioTracks().length > 0);
  hasSystemAudioTrack = captureHasAudio;

  const videoTrack = displayStream.getVideoTracks()[0];

  if (hasMicTrack && captureHasAudio) {
    audioContext = new AudioContext();
    const dest = audioContext.createMediaStreamDestination();
    audioContext.createMediaStreamSource(displayStream).connect(dest);
    audioContext.createMediaStreamSource(micStream).connect(dest);
    return new MediaStream([videoTrack, dest.stream.getAudioTracks()[0]]);
  }
  if (captureHasAudio) return new MediaStream([videoTrack, ...displayStream.getAudioTracks()]);
  if (hasMicTrack)     return new MediaStream([videoTrack, micStream.getAudioTracks()[0]]);
  return new MediaStream([videoTrack]);
}

// Reflect what is actually being captured in the status chips.
function updateCaptureChips() {
  if (chipMic) {
    chipMic.classList.toggle('on', hasMicTrack);
    chipMic.classList.toggle('off', !hasMicTrack);
    const label = chipMic.querySelector('.rec-chip-label');
    if (label) label.textContent = hasMicTrack
      ? t('rec_chip_mic', 'Microphone')
      : t('rec_chip_mic_off', 'Mic off');
  }
  if (chipSysAudio) {
    chipSysAudio.classList.toggle('on', hasSystemAudioTrack);
    chipSysAudio.classList.toggle('off', !hasSystemAudioTrack);
    const label = chipSysAudio.querySelector('.rec-chip-label');
    if (label) label.textContent = hasSystemAudioTrack
      ? t('rec_chip_sysaudio', 'System audio')
      : t('rec_chip_no_sysaudio', 'No system audio');
  }
}

// Live mic meter shown next to the mic chip during recording.
function startMicLevelMonitor(stream) {
  stopMicLevelMonitor();
  try {
    micLevelCtx = new AudioContext();
    micLevelAnalyser = micLevelCtx.createAnalyser();
    micLevelAnalyser.fftSize = 256;
    micLevelAnalyser.smoothingTimeConstant = 0.5;
    micLevelCtx.createMediaStreamSource(stream).connect(micLevelAnalyser);
    const dataArray = new Uint8Array(micLevelAnalyser.frequencyBinCount);
    const loop = () => {
      if (micLiveBar) micLiveBar.style.width = computeLevel(micLevelAnalyser, dataArray) + '%';
      micLevelRaf = requestAnimationFrame(loop);
    };
    loop();
  } catch (_) {
    // meter is best-effort — recording still proceeds
  }
}

function stopMicLevelMonitor() {
  if (micLevelRaf) { cancelAnimationFrame(micLevelRaf); micLevelRaf = null; }
  if (micLevelCtx) { micLevelCtx.close().catch(() => {}); micLevelCtx = null; }
  micLevelAnalyser = null;
  if (micLiveBar) micLiveBar.style.width = '0%';
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
  if (doneLinkRow)  doneLinkRow.style.display = 'none';
  if (claimRow)     claimRow.style.display    = 'none';
  if (progressText) progressText.style.display = '';

  const durationSec = getRecordedDurationSec();

  try {
    const result = await chunkedUploadFromPage(recordingBlob, {
      durationSec,
      onProgress: (percent) => setProgress(percent),
    });

    // Ensure progress bar shows 100% before we hand over the link
    setProgress(100);

    // Upload is persisted server-side now — release the beforeunload guard so
    // neither the auto-redirect nor the guest claim gate triggers a "Leave?" prompt.
    state = 'done';

    const shareToken = result.share_token;
    const shareUrl   = `${window.location.origin}/share/${shareToken}`;

    // Release blob memory — upload is complete, we no longer need it
    revokeBlobUrl();
    recordingBlob = null;

    // Guest users must claim the recording (enter email) before we reveal the
    // share link. Registered users get the link immediately, then redirect.
    let isGuest = false;
    try { isGuest = !!(await getCurrentUserAsync())?.is_guest; } catch (_) {}

    if (isGuest) {
      showClaimGate(shareUrl);
    } else {
      revealShareLink(shareUrl);
      if (progressText) progressText.textContent = t('rec_done', 'Done! Redirecting…');
      setTimeout(() => { window.location.href = shareUrl; }, 1500);
    }

  } catch (err) {
    console.error('[recorder-page] upload error:', err);
    showError(
      t('rec_err_upload', 'Upload failed'),
      err.message || t('rec_err_upload', 'Upload failed'),
      true, // showRetry
    );
  }
}

/* ── Share link reveal + guest claim gate ─────────────────────────────────── */
function revealShareLink(url) {
  if (doneLinkInput) doneLinkInput.value = url;
  if (doneLinkRow)   doneLinkRow.style.display = '';
}

function showClaimGate(shareUrl) {
  pendingShareUrl = shareUrl;
  if (progressText) progressText.style.display = 'none';
  if (claimEmail)   claimEmail.placeholder = t('rec_claim_email_ph', 'you@example.com');
  if (claimRow)     claimRow.style.display = '';
  claimEmail?.focus();
}

function setClaimMsg(text, { isError = false, html = null } = {}) {
  if (!claimMsg) return;
  if (html != null) claimMsg.innerHTML = html;
  else              claimMsg.textContent = text;
  claimMsg.style.display = (text || html) ? '' : 'none';
  claimMsg.style.color = isError ? 'var(--danger, #dc2626)' : 'var(--text-dim)';
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function handleClaimSubmit(e) {
  e.preventDefault();
  const email = (claimEmail?.value || '').trim();
  if (!EMAIL_RE.test(email)) {
    setClaimMsg(t('rec_claim_email_invalid', 'Enter a valid email address.'), { isError: true });
    return;
  }
  const label = claimSubmit?.querySelector('span');
  const origLabel = label?.textContent;
  if (claimSubmit) claimSubmit.disabled = true;
  if (label) label.textContent = t('rec_claim_sending', 'Sending…');
  setClaimMsg('');

  try {
    const res = await fetch('/api/auth/upgrade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ email }),
    });
    const data = await res.json().catch(() => ({}));

    if (res.ok && data.ok) {
      // Email accepted — reveal the link now (optimistic); confirmation email
      // sent in parallel. Retention extends only after they click that link.
      if (claimForm) claimForm.style.display = 'none';
      revealShareLink(pendingShareUrl);
      setClaimMsg(t('rec_claim_confirm', 'Your link is ready. Check your email to confirm and keep your recording.'));
      return;
    }

    if (res.status === 409 || data.error === 'email_taken') {
      const loginUrl = data.login_url || '/login';
      setClaimMsg('', {
        isError: true,
        html: `${t('rec_claim_taken', 'This email is already registered.')} `
            + `<a href="${loginUrl}">${t('rec_claim_login', 'Log in')}</a>`,
      });
    } else {
      setClaimMsg(t('rec_claim_err', 'Something went wrong. Please try again.'), { isError: true });
    }
  } catch (_) {
    setClaimMsg(t('rec_claim_err', 'Something went wrong. Please try again.'), { isError: true });
  } finally {
    if (claimSubmit) claimSubmit.disabled = false;
    if (label && origLabel) label.textContent = origLabel;
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

  stopMicTest(); // release the pre-flight test stream before we capture for real
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

  // Live preview (display stream only — element is muted, so no echo)
  if (liveVideo) {
    liveVideo.srcObject = stream;
    // autoplay attribute on the element handles playback
  }

  // Capture the microphone separately and mix it in — getDisplayMedia alone
  // never includes the mic, only system/tab audio.
  const recordStream = await buildRecordStream(stream);
  updateCaptureChips();

  const mimeType = pickMime();
  try {
    mediaRecorder = new MediaRecorder(recordStream, {
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

  // Live mic meter — lets the user SEE the mic responding while recording
  if (hasMicTrack && micStream) startMicLevelMonitor(micStream);

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
if (claimForm)      claimForm.addEventListener('submit', handleClaimSubmit);
if (micTestBtn)     micTestBtn.addEventListener('click', toggleMicTest);
if (optMic)         optMic.addEventListener('change', () => { if (!optMic.checked) stopMicTest(); });

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
