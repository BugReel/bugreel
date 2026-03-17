/* setup-firefox.js — First-run setup wizard for Firefox */

const isMac = navigator.platform?.includes('Mac') || navigator.userAgent?.includes('Macintosh');
let micDone = false;
let screenDone = false;

function setResult(id, type, text) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.className = 'result ' + type;
}

function activateStep(n) {
  document.querySelectorAll('.step').forEach((s, i) => {
    s.classList.remove('active');
    if (i < n - 1) s.classList.add('done');
  });
  const step = document.getElementById('step-' + n);
  if (step) step.classList.add('active');
}

function checkAllDone() {
  if (micDone && screenDone) {
    activateStep(3);
    document.getElementById('step-3')?.classList.add('done');
    document.getElementById('btn-done')?.classList.remove('hidden');
    chrome.storage.local.set({ firefoxSetupComplete: true });
  }
}

// --- Step 1: Microphone ---

document.getElementById('btn-mic')?.addEventListener('click', async () => {
  const btn = document.getElementById('btn-mic');
  btn.disabled = true;
  btn.textContent = 'Requesting...';

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    micDone = true;
    setResult('mic-result', 'ok', 'Microphone allowed!');
    btn.textContent = 'Done';
    activateStep(2);
    checkAllDone();
    // Start live mic level visualization
    startMicLevel(stream);
  } catch (e) {
    btn.disabled = false;
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg> Try Again';
    setResult('mic-result', 'err', 'Denied: ' + (e.message || 'Permission denied'));
  }
});

// Live mic level visualization
function startMicLevel(stream) {
  const container = document.getElementById('mic-live');
  const fill = document.getElementById('mic-level-fill');
  const val = document.getElementById('mic-level-val');
  if (!container || !fill) return;

  container.classList.remove('hidden');

  const ctx = new AudioContext();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.5;
  ctx.createMediaStreamSource(stream).connect(analyser);

  const data = new Uint8Array(analyser.frequencyBinCount);
  setInterval(() => {
    analyser.getByteFrequencyData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i];
    const level = Math.min(100, Math.round((sum / data.length) * 1.5));
    fill.style.width = level + '%';
    fill.style.background = level > 5 ? '#22c55e' : '#334155';
    if (val) val.textContent = level + '%';
  }, 80);
}

// Check if mic already granted
(async () => {
  try {
    const perm = await navigator.permissions.query({ name: 'microphone' });
    if (perm.state === 'granted') {
      micDone = true;
      setResult('mic-result', 'ok', 'Already granted');
      document.getElementById('btn-mic').textContent = 'Done';
      document.getElementById('btn-mic').disabled = true;
      activateStep(2);
      // Auto-start mic level to show it works
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        startMicLevel(stream);
      } catch {}
    }
  } catch {}
})();

// --- Step 2: Screen Recording ---

// Hide step 2 on non-macOS (screen recording permission is macOS-specific)
if (!isMac) {
  const step2 = document.getElementById('step-2');
  if (step2) {
    const body = document.getElementById('step-2-body');
    if (body) body.innerHTML = '<p>No additional settings required for your OS.</p><p style="color:#22c55e;font-weight:600;">Automatically skipped.</p>';
    screenDone = true;
    step2.classList.add('done');
    checkAllDone();
  }
}

// Try to open macOS System Preferences to Screen Recording
document.getElementById('btn-open-settings')?.addEventListener('click', () => {
  // macOS URL scheme for Privacy & Security > Screen Recording
  const urls = [
    'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
    'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_ScreenCapture'
  ];
  // Try to open — may not work from extension context
  try {
    window.open(urls[0]);
  } catch {
    try {
      window.open(urls[1]);
    } catch {
      setResult('screen-result', 'info', 'Could not open automatically. Open manually: System Settings → Privacy & Security → Screen Recording');
    }
  }
});

document.getElementById('btn-screen')?.addEventListener('click', async () => {
  const btn = document.getElementById('btn-screen');
  btn.disabled = true;
  btn.textContent = 'Checking...';

  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    stream.getTracks().forEach(t => t.stop());
    screenDone = true;
    setResult('screen-result', 'ok', 'Screen recording works!');
    btn.textContent = 'Done';
    checkAllDone();
  } catch (e) {
    btn.disabled = false;
    btn.textContent = 'Check Again';
    const msg = e.message || '';
    if (msg.includes('not found') || e.name === 'NotFoundError') {
      setResult('screen-result', 'err', 'Firefox does not have screen recording access. Enable the toggle in System Settings and restart Firefox.');
    } else if (e.name === 'NotAllowedError') {
      setResult('screen-result', 'info', 'You cancelled screen selection. Click again and select a screen or tab.');
    } else {
      setResult('screen-result', 'err', 'Error: ' + msg);
    }
  }
});

// --- Step 3: Done ---

document.getElementById('btn-done')?.addEventListener('click', () => {
  window.close();
});
