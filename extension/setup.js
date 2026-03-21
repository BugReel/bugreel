/* setup.js — Universal first-run setup wizard (Chrome + Firefox) */

const t = (key, fallback) => {
  try { return chrome.i18n?.getMessage(key) || fallback || key; }
  catch { return fallback || key; }
};

const isMac = navigator.platform?.includes('Mac') || navigator.userAgent?.includes('Macintosh');
const isFirefox = navigator.userAgent?.includes('Firefox');
const isChrome = !isFirefox;
const needsScreenStep = isFirefox && isMac; // Only Firefox on macOS needs screen recording setup

let micDone = false;
let screenDone = !needsScreenStep; // Auto-done if not needed
let authDone = false;

// --- Adapt UI for browser ---
(function adaptUI() {
  const subtitle = document.getElementById('subtitle');
  if (subtitle) subtitle.textContent = isFirefox ? t('setup_subtitle_firefox', 'Firefox Setup') : t('setup_chromeSetup', 'Chrome Setup');

  // Hide step 2 entirely for Chrome (screen recording works out of the box)
  if (!needsScreenStep) {
    const step2 = document.getElementById('step-2');
    if (step2) step2.classList.add('hidden');
    // Renumber auth step
    const authNum = document.getElementById('auth-num');
    if (authNum) authNum.textContent = '2';
    // Done step number
    const doneNum = document.getElementById('done-num');
    if (doneNum) doneNum.textContent = '3';
  } else {
    const doneNum = document.getElementById('done-num');
    if (doneNum) doneNum.textContent = '4';
  }

  // On Chrome: customize done text
  if (isChrome) {
    const doneText = document.getElementById('done-text');
    if (doneText) doneText.textContent = t('setup_complete', 'Setup complete. Click the extension icon to start recording!');
  }
})();

function setResult(id, type, text) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.className = 'result ' + type;
}

function activateStep(id) {
  document.querySelectorAll('.step').forEach(s => s.classList.remove('active'));
  const step = document.getElementById(id);
  if (step) step.classList.add('active');
}

function markDone(id) {
  const step = document.getElementById(id);
  if (step) { step.classList.remove('active'); step.classList.add('done'); }
}

function checkAllDone() {
  if (!micDone || !screenDone) return;

  if (authDone) {
    // All steps complete
    markDone('step-1');
    if (needsScreenStep) markDone('step-2');
    markDone('step-auth');
    const stepDone = document.getElementById('step-done');
    if (stepDone) { stepDone.classList.add('active', 'done'); }
    document.getElementById('btn-done')?.classList.remove('hidden');
    const doneText = document.getElementById('done-text');
    if (doneText) doneText.textContent = t('setup_complete', 'Setup complete. Click the extension icon to start recording!');
    chrome.storage.local.set({ setupComplete: true });
  } else {
    // Mic/screen done, auth still pending — show auth step as active, allow finishing
    const stepAuth = document.getElementById('step-auth');
    if (stepAuth && !stepAuth.classList.contains('done')) {
      stepAuth.classList.add('active');
    }
    const stepDone = document.getElementById('step-done');
    if (stepDone) { stepDone.classList.add('active'); }
    document.getElementById('btn-done')?.classList.remove('hidden');
    const doneText = document.getElementById('done-text');
    if (doneText) {
      doneText.textContent = t('setup_permissions_configured', 'Permissions configured. You can connect your account above, or start recording now.');
    }
    chrome.storage.local.set({ setupComplete: true });
  }
}

// --- Step 1: Microphone ---

document.getElementById('btn-mic')?.addEventListener('click', async () => {
  const btn = document.getElementById('btn-mic');
  btn.disabled = true;
  btn.textContent = t('setup_requesting', 'Requesting...');

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    micDone = true;
    chrome.storage.local.set({ micPermissionGranted: true });
    setResult('mic-result', 'ok', t('setup_micAllowed', 'Microphone allowed!'));
    btn.textContent = t('setup_done', 'Done');
    markDone('step-1');
    if (needsScreenStep) {
      activateStep('step-2');
    }
    checkAllDone();
    startMicLevel(stream);
  } catch (e) {
    btn.disabled = false;
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg> ' + t('setup_tryAgain', 'Try Again');
    setResult('mic-result', 'err', (e.message || t('error_failed', 'Failed')));
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
      setResult('mic-result', 'ok', t('setup_micAlreadyGranted', 'Already granted'));
      document.getElementById('btn-mic').textContent = t('setup_done', 'Done');
      document.getElementById('btn-mic').disabled = true;
      markDone('step-1');
      if (needsScreenStep) activateStep('step-2');
      checkAllDone();
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        startMicLevel(stream);
      } catch {}
    }
  } catch {}
})();

// --- Step 2: Screen Recording (Firefox + macOS only) ---

document.getElementById('btn-open-settings')?.addEventListener('click', () => {
  try {
    window.open('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
  } catch {
    try {
      window.open('x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_ScreenCapture');
    } catch {
      setResult('screen-result', 'info', t('setup_openManually', 'Open manually: System Settings → Privacy & Security → Screen Recording'));
    }
  }
});

document.getElementById('btn-screen')?.addEventListener('click', async () => {
  const btn = document.getElementById('btn-screen');
  btn.disabled = true;
  btn.textContent = t('setup_checking', 'Checking...');

  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    stream.getTracks().forEach(t => t.stop());
    screenDone = true;
    setResult('screen-result', 'ok', t('setup_screenWorks', 'Screen recording works!'));
    btn.textContent = t('setup_done', 'Done');
    markDone('step-2');
    checkAllDone();
  } catch (e) {
    btn.disabled = false;
    btn.textContent = t('setup_checkAgain', 'Check Again');
    const msg = e.message || '';
    if (msg.includes('not found') || e.name === 'NotFoundError') {
      setResult('screen-result', 'err', t('setup_noScreenAccess', 'No screen recording access. Enable the toggle in System Settings and restart Firefox.'));
    } else if (e.name === 'NotAllowedError' || msg.includes('transient')) {
      setResult('screen-result', 'info', t('setup_cancelledScreen', 'You cancelled screen selection. Click again and select a screen.'));
    } else {
      setResult('screen-result', 'err', t('error_failed', 'Error') + ': ' + msg);
    }
  }
});

// --- Step: Connect Account (extension token) ---

document.getElementById('btn-connect-token')?.addEventListener('click', async () => {
  const tokenInput = document.getElementById('input-token');
  const token = (tokenInput?.value || '').trim();
  if (!token) {
    setResult('token-result', 'err', t('setup_pasteToken', 'Please paste your extension token'));
    return;
  }

  const btn = document.getElementById('btn-connect-token');
  btn.disabled = true;
  btn.textContent = t('setup_verifying', 'Verifying...');
  setResult('token-result', '', '');

  // We need a server URL to verify the token. Try to get it from storage.
  const stored = await chrome.storage.local.get('serverUrl');
  const serverUrl = stored.serverUrl || '';

  if (!serverUrl) {
    btn.disabled = false;
    btn.textContent = t('button_connect', 'Connect');
    setResult('token-result', 'err', t('setup_serverUrlNotConfigured', 'Server URL not configured. Set it in the extension popup first, then return here.'));
    return;
  }

  try {
    const res = await fetch(`${serverUrl}/api/auth/me`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) {
      throw new Error(res.status === 401 ? t('setup_invalidToken', 'Invalid or expired token') : (t('setup_serverError', 'Server error') || 'Server error') + ` ${res.status}`);
    }
    const data = await res.json();
    if (!data.ok || !data.user) {
      throw new Error(t('setup_invalidResponse', 'Invalid server response'));
    }

    // Save token and user info
    await chrome.storage.local.set({
      extensionToken: token,
      userName: data.user.name || '',
      userEmail: data.user.email || ''
    });

    authDone = true;
    setResult('token-result', 'ok', t('setup_connected', 'Connected!'));
    btn.textContent = t('setup_done', 'Done');

    // Show user info
    const userInfo = document.getElementById('auth-user-info');
    const userName = document.getElementById('auth-user-name');
    if (userInfo && userName) {
      const displayName = data.user.name || data.user.email.split('@')[0];
      userName.textContent = `${displayName} (${data.user.email})`;
      userInfo.classList.remove('hidden');
    }
    tokenInput.disabled = true;

    markDone('step-auth');
    checkAllDone();
  } catch (e) {
    btn.disabled = false;
    btn.textContent = t('button_connect', 'Connect');
    setResult('token-result', 'err', e.message || t('setup_connectionFailed', 'Connection failed'));
  }
});

// Check if token already exists in storage
(async () => {
  const stored = await chrome.storage.local.get(['extensionToken', 'userName', 'userEmail', 'serverUrl']);
  if (stored.extensionToken && stored.serverUrl) {
    // Verify the token is still valid
    try {
      const res = await fetch(`${stored.serverUrl}/api/auth/me`, {
        headers: { 'Authorization': `Bearer ${stored.extensionToken}` }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.ok && data.user) {
          authDone = true;
          setResult('token-result', 'ok', t('setup_alreadyConnected', 'Already connected'));
          const btn = document.getElementById('btn-connect-token');
          if (btn) { btn.textContent = t('setup_done', 'Done'); btn.disabled = true; }
          const tokenInput = document.getElementById('input-token');
          if (tokenInput) { tokenInput.value = stored.extensionToken.slice(0, 8) + '...'; tokenInput.disabled = true; }
          const userInfo = document.getElementById('auth-user-info');
          const userName = document.getElementById('auth-user-name');
          if (userInfo && userName) {
            const displayName = data.user.name || data.user.email.split('@')[0];
            userName.textContent = `${displayName} (${data.user.email})`;
            userInfo.classList.remove('hidden');
          }
          markDone('step-auth');
          checkAllDone();
        }
      }
    } catch {}
  }
})();

// --- Done ---

document.getElementById('btn-done')?.addEventListener('click', () => {
  window.close();
});
