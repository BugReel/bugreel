/* popup.js — BugReel popup UI */

const t = (key, fallback) => {
  try { return chrome.i18n?.getMessage(key) || fallback || key; }
  catch { return fallback || key; }
};

let SERVER_URL = '';
let DASHBOARD_PATH = '/'; // Can be overridden by branded builds (e.g. '/app/')
let hasExtensionToken = false;
let currentUserName = '';

// Load server URL from storage (set during setup)
async function getServerUrl() {
  const r = await chrome.storage.local.get('serverUrl');
  return r.serverUrl || '';
}


const $ = id => document.getElementById(id);
const controls       = $('controls');
const inputAuthor    = $('input-author');
const sourceSelector = $('source-selector');
const toggleMic      = $('toggle-mic');
const toggleSystem   = $('toggle-system');
const toggleWebcam   = $('toggle-webcam');
const webcamDeviceField = $('webcam-device-field');
const selectWebcamDevice = $('select-webcam-device');
const micLevelBar    = $('mic-level-bar');
const micLevelLabel  = $('mic-level-label');
const micLevelContainer = $('mic-level-container');
const micStatus      = $('mic-status');
const micStatusDot   = $('mic-status-dot');
const micStatusText  = $('mic-status-text');
const timerEl        = $('timer');
const recAudioStatus = $('rec-audio-status');
const badgeMic       = $('badge-mic');
const badgeSystem    = $('badge-system');
const badgeWebcam    = $('badge-webcam');
const statusDot      = $('status-dot');
const statusText     = $('status-text');

// State panels
const stateIdle      = $('state-idle');
const stateRecording = $('state-recording');
const statePaused    = $('state-paused');
const stateReady     = $('state-ready');

// Buttons
const btnStart  = $('btn-start');
const btnPause  = $('btn-pause');
const btnStop   = $('btn-stop');
const btnResume = $('btn-resume');
const btnFinish = $('btn-finish');

let currentState = 'idle';
let captureMode = 'tab';
let micPreviewing = false;
let micPermissionGranted = false;
let micHardwareAvailable = true; // Whether a mic device exists on the system
let isFirefox = false;
let timerInterval = null;
let timerStartedAt = 0;
let timerPausedElapsed = 0;

/* --- Init --- */

(async function init() {
  const stored = await chrome.storage.local.get([
    'author', 'captureMode', 'micEnabled', 'systemAudioEnabled',
    'webcamEnabled', 'webcamDeviceId',
    'extensionState', 'recordingStartedAt', 'pausedElapsed', 'serverUrl',
    'extensionToken', 'userName', 'userEmail', 'userIsGuest',
    'maxDuration', 'videoQuality', 'afterRecording',
    'serverMaxDurationMin', 'serverPlan'
  ]);
  SERVER_URL = stored.serverUrl || '';

  captureMode = stored.captureMode || 'tab';
  updateSourceSelector();
  toggleMic.checked = stored.micEnabled !== false;
  toggleSystem.checked = stored.systemAudioEnabled !== false;
  toggleWebcam.checked = stored.webcamEnabled === true;
  if (toggleWebcam.checked) {
    webcamDeviceField.classList.remove('hidden');
    populateWebcamDevices(stored.webcamDeviceId || '');
  }

  // Settings — max duration badge (read-only, shows plan limit)
  const maxDurLabel = $('max-duration-label');
  const selQuality = $('setting-quality');
  const selAfterRec = $('setting-after-recording');
  if (maxDurLabel) {
    const serverMax = stored.serverMaxDurationMin;
    const maxMin = serverMax || 10; // Default 10 min for standalone BugReel
    maxDurLabel.textContent = maxMin >= 60 ? `${maxMin / 60} ${t('popup_settingHour', 'hr')}` : `${maxMin} ${t('popup_settingMin', 'min')}`;
    // Always store plan limit as maxDuration so background.js uses it
    chrome.storage.local.set({ maxDuration: maxMin });
  }
  if (selQuality) { selQuality.value = stored.videoQuality || '720p'; selQuality.addEventListener('change', () => chrome.storage.local.set({ videoQuality: selQuality.value })); }
  if (selAfterRec) { selAfterRec.value = stored.afterRecording || 'review'; selAfterRec.addEventListener('change', () => chrome.storage.local.set({ afterRecording: selAfterRec.value })); }

  // Check for token-based auth vs legacy author dropdown
  if (stored.extensionToken) {
    hasExtensionToken = true;
    currentUserName = stored.userName || stored.userEmail || t('status_connected', 'Connected');
    if (stored.userIsGuest) {
      showGuestInfo(stored.serverUrl, stored.extensionToken);
    } else {
      showUserInfo(currentUserName, stored.serverPlan);
    }
    // Refresh plan from server (non-blocking)
    refreshPlanFromServer(stored.serverUrl, stored.extensionToken);
    // Hide legacy author dropdown
    const authorField = $('author-field');
    if (authorField) authorField.classList.add('hidden');
  } else {
    // No token: show setup prompt, hide author dropdown and recent recordings
    showSetupPrompt();
    const authorField = $('author-field');
    if (authorField) authorField.classList.add('hidden');
    const recentEl = $('recent-recordings');
    if (recentEl) recentEl.classList.add('hidden');
  }
  updateStartButton();

  // Check if mic hardware exists
  await checkMicHardware();

  // Detect Firefox
  const status = await chrome.runtime.sendMessage({ type: 'get-status' });
  isFirefox = status?.isFirefox || !!(typeof browser !== 'undefined' && browser.runtime?.getBrowserInfo);

  // Add setup link for both browsers
  const dashLink = document.getElementById('dashboard-link');
  if (dashLink) {
    const setupLink = document.createElement('a');
    setupLink.href = '#';
    setupLink.className = 'dashboard-link';
    setupLink.style.marginTop = '4px';
    setupLink.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg> ' + t('popup_setup', 'Setup');
    setupLink.addEventListener('click', (e) => { e.preventDefault(); chrome.tabs.create({ url: chrome.runtime.getURL('setup.html') }); });
    dashLink.parentNode.insertBefore(setupLink, dashLink.nextSibling);
  }

  await checkMicPermission();
  updateMicStatus();

  // Restore state from background
  const st = status?.state || stored.extensionState || 'idle';

  if (st === 'recording') {
    timerStartedAt = status.recordingStartedAt || Date.now();
    timerPausedElapsed = status.pausedElapsed || 0;
    showState('recording');
    startTimer();
  } else if (st === 'paused') {
    timerPausedElapsed = status.pausedElapsed || 0;
    showState('paused');
    showFrozenTimer();
  } else if (st === 'uploading') {
    showState('idle');
    $('status-bar-wrap').classList.remove('hidden');
    setStatus('working', status.uploadPaused
      ? t('status_uploadPaused', 'Загрузка на паузе')
      : t('status_uploadingToServer', 'Uploading to server...'));
    if (status.uploadChunked) {
      $('upload-ctl').classList.remove('hidden');
      if (status.uploadPaused) {
        $('ctl-pause').classList.add('hidden');
        $('ctl-resume').classList.remove('hidden');
      } else {
        $('ctl-resume').classList.add('hidden');
        $('ctl-pause').classList.remove('hidden');
      }
    }
  } else if (st === 'ready') {
    showState('ready');
  } else {
    showState('idle');
  }

  // Load recent recordings only if authenticated (without token, API returns ALL recordings on server)
  if (hasExtensionToken) {
    loadRecentRecordings();
  }

  // Show popup after state is determined (prevents flash of idle state)
  document.body.classList.add('loaded');
})();

/* --- User info / Auth --- */

function showUserInfo(name, plan) {
  if (!name) { showSetupPrompt(); return; }
  const connected = $('user-connected');
  const guest = $('user-guest');
  const notConnected = $('user-not-connected');
  const displayName = $('user-display-name');
  if (connected) { connected.classList.remove('hidden'); connected.style.display = 'flex'; }
  if (guest) { guest.classList.add('hidden'); guest.style.display = 'none'; }
  if (notConnected) { notConnected.classList.add('hidden'); notConnected.style.display = 'none'; }
  if (displayName) displayName.textContent = name;
  updatePlanBadge(plan);
}

function showGuestInfo(serverUrl, token) {
  const connected = $('user-connected');
  const guest = $('user-guest');
  const notConnected = $('user-not-connected');
  if (connected) { connected.classList.add('hidden'); connected.style.display = 'none'; }
  if (notConnected) { notConnected.classList.add('hidden'); notConnected.style.display = 'none'; }
  if (guest) { guest.classList.remove('hidden'); guest.style.display = ''; }

  updateGuestQuota(serverUrl, token);

  const link = $('link-guest-upgrade');
  if (link && !link._wired) {
    link._wired = true;
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const base = (serverUrl || '').replace(/\/$/, '');
      if (!base || !token) return;
      chrome.tabs.create({ url: `${base}/auth/upgrade#token=${encodeURIComponent(token)}` });
    });
  }
}

async function updateGuestQuota(serverUrl, token) {
  const el = $('user-guest-quota');
  if (!el || !serverUrl || !token) return;
  try {
    const res = await fetch(`${serverUrl}/api/auth/me`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) return;
    const data = await res.json();
    const max = data?.limits?.max_recordings;
    if (typeof max === 'number' && max > 0) {
      el.textContent = `${t('popup_guestLimit', 'limit')}: ${max}`;
    }
  } catch {}
}

function updatePlanBadge(plan) {
  const badge = $('user-plan-badge');
  if (!badge) return;
  const p = (plan || 'free').toLowerCase();
  const colors = {
    free: { bg: '#334155', color: '#94a3b8' },
    standard: { bg: '#1e3a5f', color: '#60a5fa' },
    pro: { bg: '#3b1f6e', color: '#a78bfa' },
    business: { bg: '#713f12', color: '#fbbf24' },
  };
  const c = colors[p] || colors.free;
  badge.textContent = p === 'free' ? 'FREE' : p.toUpperCase();
  badge.style.background = c.bg;
  badge.style.color = c.color;
}

async function refreshPlanFromServer(serverUrl, token) {
  if (!serverUrl || !token) return;
  try {
    const res = await fetch(`${serverUrl}/api/auth/me`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) return;
    const data = await res.json();
    if (!data.user) return;

    // Server is the source of truth for is_guest — re-sync local flag and
    // re-render the popup if the storage flag drifted (e.g. an upgrade
    // happened in another tab and we still have a stale guest badge).
    const isGuest = data.user.is_guest === true;
    const stored = await chrome.storage.local.get(['userIsGuest', 'userName', 'userEmail']);
    const updates = {
      userIsGuest: isGuest,
      userName: data.user.name || '',
      userEmail: data.user.email || '',
    };
    if (data.user.plan) updates.serverPlan = data.user.plan;
    const maxMin = data.limits?.max_duration_sec ? Math.floor(data.limits.max_duration_sec / 60) : null;
    if (maxMin) {
      updates.serverMaxDurationMin = maxMin;
      updates.maxDuration = maxMin;
      const maxDurLabel = $('max-duration-label');
      if (maxDurLabel) {
        maxDurLabel.textContent = maxMin >= 60 ? `${maxMin / 60} ${t('popup_settingHour', 'hr')}` : `${maxMin} ${t('popup_settingMin', 'min')}`;
      }
    }
    await chrome.storage.local.set(updates);

    if (isGuest !== !!stored.userIsGuest) {
      if (isGuest) {
        showGuestInfo(serverUrl, token);
      } else {
        currentUserName = updates.userName || updates.userEmail || t('status_connected', 'Connected');
        showUserInfo(currentUserName, updates.serverPlan);
      }
    } else if (data.user.plan) {
      updatePlanBadge(data.user.plan);
    }
  } catch { /* silent — popup should not break if server is unreachable */ }
}

function showSetupPrompt() {
  const connected = $('user-connected');
  const guest = $('user-guest');
  const notConnected = $('user-not-connected');
  if (connected) { connected.classList.add('hidden'); connected.style.display = 'none'; }
  if (guest) { guest.classList.add('hidden'); guest.style.display = 'none'; }
  if (notConnected) { notConnected.classList.remove('hidden'); notConnected.style.display = ''; }

  // Wire up the setup link
  const setupLink = document.getElementById('link-setup-auth');
  if (setupLink) {
    setupLink.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: chrome.runtime.getURL('setup.html') });
    });
  }
}

/* --- Authors (legacy fallback) --- */

async function loadAuthors(savedAuthor) {
  try {
    if (!SERVER_URL) throw 0;
    const res = await fetch(`${SERVER_URL}/api/youtrack-users`);
    if (!res.ok) throw 0;
    const data = await res.json();
    const seen = new Set();
    const users = [];
    for (const u of (data.users || [])) {
      if (!seen.has(u.youtrack_login)) { seen.add(u.youtrack_login); users.push(u); }
    }
    inputAuthor.innerHTML = `<option value="">${t('popup_selectAuthor', '-- Select --')}</option>`;
    for (const u of users) {
      const o = document.createElement('option');
      o.value = u.youtrack_login; o.textContent = u.youtrack_name || u.author;
      if (u.youtrack_login === savedAuthor || u.author === savedAuthor) o.selected = true;
      inputAuthor.appendChild(o);
    }
  } catch {
    // Fallback: allow free-text author entry if server is unavailable
    inputAuthor.innerHTML = `<option value="">${t('popup_selectAuthor', '-- Select --')}</option>`;
    if (savedAuthor) {
      const o = document.createElement('option');
      o.value = savedAuthor; o.textContent = savedAuthor;
      o.selected = true;
      inputAuthor.appendChild(o);
    }
  }
}

/* --- State management --- */

function showState(st) {
  currentState = st;
  [stateIdle, stateRecording, statePaused, stateReady].forEach(el => el.classList.add('hidden'));

  const recentEl = $('recent-recordings');
  const isActive = st === 'recording' || st === 'paused';

  if (st === 'idle') {
    stateIdle.classList.remove('hidden');
    controls.classList.remove('hidden');
    recAudioStatus.classList.add('hidden');
    timerEl.classList.add('hidden');
    $('status-bar-wrap').classList.add('hidden');
  } else if (st === 'recording') {
    stateRecording.classList.remove('hidden');
    controls.classList.add('hidden');
    recAudioStatus.classList.remove('hidden');
    timerEl.classList.remove('hidden');
    timerEl.className = 'timer';
    $('status-bar-wrap').classList.remove('hidden');
    setStatus('recording', t('status_recording', 'Recording'));
    // Show recording hint, auto-hide after 8s
    const hint = $('rec-hint');
    if (hint) { hint.style.opacity = '1'; hint.style.display = ''; setTimeout(() => { hint.style.opacity = '0'; setTimeout(() => hint.style.display = 'none', 300); }, 8000); }
  } else if (st === 'paused') {
    statePaused.classList.remove('hidden');
    controls.classList.add('hidden');
    recAudioStatus.classList.remove('hidden');
    timerEl.classList.remove('hidden');
    timerEl.className = 'timer paused';
    $('status-bar-wrap').classList.remove('hidden');
    setStatus('working', t('status_paused', 'Paused'));
  } else if (st === 'ready') {
    stateReady.classList.remove('hidden');
    controls.classList.remove('hidden');
    recAudioStatus.classList.add('hidden');
    timerEl.classList.add('hidden');
    $('status-bar-wrap').classList.add('hidden');
  }

  // Hide Recent during recording/paused — less clutter
  if (recentEl) {
    if (isActive) recentEl.classList.add('hidden');
  }

  updateMicStatus();
}

/* --- Mic hardware detection --- */

async function checkMicHardware() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devices.filter(d => d.kind === 'audioinput');
    // Firefox returns empty deviceId in popup context even when permission was granted
    // in settings page, so also check stored permission as proof hardware exists
    const stored = await chrome.storage.local.get(['micPermissionGranted']);
    micHardwareAvailable = audioInputs.length > 0 &&
      (audioInputs.some(d => d.deviceId !== '') || stored.micPermissionGranted);
  } catch {
    micHardwareAvailable = true; // Assume available if we can't check
  }

  if (!micHardwareAvailable) {
    toggleMic.checked = false;
    chrome.storage.local.set({ micEnabled: false });
  }
}

/* --- Mic permission check (storage flag + permissions.query fallback) --- */

async function checkMicPermission() {
  // Primary: check storage flag (set by mic-permission.html and setup page)
  const stored = await chrome.storage.local.get(['micPermissionGranted']);
  if (stored.micPermissionGranted) {
    micPermissionGranted = true;
    return;
  }

  // Fallback: permissions.query (works in some contexts)
  try {
    const result = await navigator.permissions.query({ name: 'microphone' });
    micPermissionGranted = result.state === 'granted';
    if (micPermissionGranted) {
      chrome.storage.local.set({ micPermissionGranted: true });
    }
    result.addEventListener('change', () => {
      micPermissionGranted = result.state === 'granted';
      if (micPermissionGranted) {
        chrome.storage.local.set({ micPermissionGranted: true });
      }
      updateMicStatus();
    });
  } catch {
    micPermissionGranted = false;
  }
}

// React to permission granted from mic-permission.html while popup is open
chrome.storage.onChanged.addListener((changes) => {
  if (changes.micPermissionGranted?.newValue) {
    micPermissionGranted = true;
    updateMicStatus();
  }
});

function updateMicStatus() {
  const warn = $('mic-permission-warn');
  const isRecording = currentState === 'recording' || currentState === 'paused';

  if (isRecording) {
    // During recording: show live level bar, hide status dot
    micStatus.classList.add('hidden');
    micLevelContainer.classList.remove('hidden');
    micLevelContainer.classList.remove('inactive');
    if (warn) warn.classList.add('hidden');
    return;
  }

  // Idle/ready: hide level bar, show status indicator
  micLevelContainer.classList.add('hidden');

  if (!toggleMic.checked) {
    if (!micHardwareAvailable) {
      micStatusDot.className = 'mic-status-dot denied';
      micStatusText.textContent = t('popup_micNotFound', 'Not found');
      micStatus.classList.remove('hidden');
    } else {
      micStatus.classList.add('hidden');
    }
    if (warn) warn.classList.add('hidden');
    return;
  }

  // Mic toggle is ON — show permission status
  if (!micHardwareAvailable) {
    micStatusDot.className = 'mic-status-dot denied';
    micStatusText.textContent = t('popup_micNotFound', 'Not found');
    micStatus.classList.remove('hidden');
    if (warn) warn.classList.add('hidden');
  } else if (micPermissionGranted) {
    micStatusDot.className = 'mic-status-dot ready';
    micStatusText.textContent = t('popup_micReady', 'Ready');
    micStatus.classList.remove('hidden');
    if (warn) warn.classList.add('hidden');
  } else {
    micStatus.classList.add('hidden');
    if (warn) warn.classList.remove('hidden');
  }
}

/* --- Mic preview (used only for cleanup on popup close) --- */

function stopMicPreview() {
  if (!micPreviewing) return;
  micPreviewing = false;
  micLevelBar.style.width = '0%';

  if (isFirefox) {
    // No local preview anymore
  } else {
    chrome.runtime.sendMessage({ type: 'mic-preview-stop' }).catch(() => {});
  }
}

/* --- Toggle handlers --- */

toggleMic.addEventListener('change', () => {
  chrome.storage.local.set({ micEnabled: toggleMic.checked });
  if (!toggleMic.checked) {
    stopMicPreview();
  }
  updateMicStatus();
});
toggleSystem.addEventListener('change', () => chrome.storage.local.set({ systemAudioEnabled: toggleSystem.checked }));

// Webcam toggle — check camera permission, open permission page if needed
toggleWebcam.addEventListener('change', async () => {
  chrome.storage.local.set({ webcamEnabled: toggleWebcam.checked });
  if (toggleWebcam.checked) {
    // Check if camera permission is already granted
    const stored = await chrome.storage.local.get(['webcamPermissionGranted']);
    if (!stored.webcamPermissionGranted) {
      // Try to check via permissions API
      let granted = false;
      try {
        const cam = await navigator.permissions.query({ name: 'camera' });
        granted = cam.state === 'granted';
      } catch {}

      if (!granted) {
        // Open permission page — can't request camera from popup or offscreen
        chrome.tabs.create({ url: chrome.runtime.getURL('mic-permission.html') });
      }
    }
    webcamDeviceField.classList.remove('hidden');
    populateWebcamDevices();
  } else {
    webcamDeviceField.classList.add('hidden');
  }
});

// Webcam device selection
if (selectWebcamDevice) {
  selectWebcamDevice.addEventListener('change', () => {
    chrome.storage.local.set({ webcamDeviceId: selectWebcamDevice.value });
  });
}



async function populateWebcamDevices(savedDeviceId) {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoInputs = devices.filter(d => d.kind === 'videoinput');
    selectWebcamDevice.innerHTML = '';
    if (videoInputs.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = t('popup_noWebcam', 'No camera found');
      selectWebcamDevice.appendChild(opt);
      return;
    }
    for (const dev of videoInputs) {
      const opt = document.createElement('option');
      opt.value = dev.deviceId;
      opt.textContent = dev.label || t('popup_defaultCamera', 'Camera') + ' ' + (selectWebcamDevice.options.length + 1);
      if (savedDeviceId && dev.deviceId === savedDeviceId) opt.selected = true;
      selectWebcamDevice.appendChild(opt);
    }
  } catch {
    selectWebcamDevice.innerHTML = '<option value="">' + t('popup_defaultCamera', 'Default camera') + '</option>';
  }
}
if (inputAuthor) {
  inputAuthor.addEventListener('change', () => {
    chrome.storage.local.set({ author: inputAuthor.value });
    updateStartButton();
    loadRecentRecordings();
  });
}

sourceSelector.addEventListener('click', (e) => {
  const opt = e.target.closest('.source-option');
  if (!opt || (currentState !== 'idle' && currentState !== 'ready')) return;
  captureMode = opt.dataset.mode;
  chrome.storage.local.set({ captureMode });
  updateSourceSelector();
});

function updateSourceSelector() {
  sourceSelector.querySelectorAll('.source-option').forEach(o => o.classList.toggle('active', o.dataset.mode === captureMode));
}

/* --- Button handlers --- */

function updateStartButton() {
  // Always enabled — recording works with or without token.
  // With token: user identified via Bearer token.
  // Without token: recording uploads as anonymous (self-hosted use case).
  btnStart.disabled = false;
  const btnNew = document.getElementById('btn-new-recording');
  if (btnNew) btnNew.disabled = false;
}

// Ready state buttons
document.getElementById('btn-open-review')?.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('review.html') });
});
document.getElementById('btn-new-recording')?.addEventListener('click', () => startNewRecording());
btnStart.addEventListener('click', () => startNewRecording());

async function startNewRecording() {
  // Determine author: from token (userName), legacy dropdown, or fallback to 'anonymous'
  const author = hasExtensionToken ? currentUserName : (inputAuthor.value || 'anonymous');

  // Mic not granted: record without mic instead of blocking
  let micEnabled = toggleMic.checked;
  if (micEnabled && !micPermissionGranted) {
    micEnabled = false; // Will record without mic
  }

  // Discard previous recording blob if exists (prevents "No recording found" on stale review tab)
  if (currentState === 'ready') {
    await chrome.runtime.sendMessage({ type: 'discard-recording' });
  }

  await chrome.storage.local.set({ author: author || 'unknown', captureMode, serverUrl: SERVER_URL });

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab && captureMode === 'tab') { setStatus('error', t('error_noActiveTab', 'No active tab')); return; }

  if (!SERVER_URL) { setStatus('error', t('error_serverNotConfigured', 'Server URL not configured. Open Setup.')); return; }
  setStatus('working', captureMode === 'desktop' ? t('status_chooseSource', 'Choose source...') : t('status_starting', 'Starting...'));
  btnStart.disabled = true;
  stopMicPreview();

  try {
    const webcamSettings = toggleWebcam.checked ? {
      webcamEnabled: true,
      webcamDeviceId: selectWebcamDevice.value || ''
    } : { webcamEnabled: false };

    const result = await chrome.runtime.sendMessage({
      type: 'start-recording', tabId: tab?.id, mode: captureMode,
      micEnabled: micEnabled, systemAudioEnabled: toggleSystem.checked,
      ...webcamSettings,
      screenInfo: {
        width: screen.width,
        height: screen.height,
        devicePixelRatio: window.devicePixelRatio,
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight
      }
    });
    if (result?.success) {
      if (isFirefox) {
        // Firefox: don't show recording yet — wait for recorder tab to confirm
        $('status-bar-wrap').classList.remove('hidden');
        setStatus('working', t('status_selectScreen', 'Select screen for recording...'));
        // Popup will likely close when recorder tab opens — state updates via storage
      } else {
        const s = await chrome.storage.local.get(['recordingStartedAt', 'pausedElapsed']);
        timerStartedAt = s.recordingStartedAt || Date.now();
        timerPausedElapsed = s.pausedElapsed || 0;
        showState('recording');
        startTimer();
      }
    } else {
      btnStart.disabled = false;
      setStatus('error', result?.error || t('error_failed', 'Failed'));
    }
  } catch (err) {
    btnStart.disabled = false;
    setStatus('error', err.message);
  }
}

btnPause.addEventListener('click', async () => {
  // Calculate elapsed BEFORE sending pause (we have the timer values locally)
  timerPausedElapsed = timerPausedElapsed + (Date.now() - timerStartedAt);
  await chrome.runtime.sendMessage({ type: 'pause-recording' });
  stopTimer();
  showState('paused');
  showFrozenTimer();
});

btnStop.addEventListener('click', async () => {
  const prefs = await chrome.storage.local.get('afterRecording');
  await chrome.runtime.sendMessage({ type: 'stop-and-upload' });
  stopTimer();
  if (prefs.afterRecording === 'auto-upload') {
    showState('idle');
    $('status-bar-wrap').classList.remove('hidden');
    setStatus('working', t('status_uploadingToServer', 'Uploading to server...'));
  } else {
    // Default: go to review screen
    $('status-bar-wrap').classList.remove('hidden');
    setStatus('working', t('status_saving', 'Saving recording...'));
  }
});

btnResume.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'resume-recording' });
  const s = await chrome.storage.local.get(['recordingStartedAt', 'pausedElapsed']);
  timerStartedAt = s.recordingStartedAt || Date.now();
  timerPausedElapsed = s.pausedElapsed || 0;
  showState('recording');
  startTimer();
});

btnFinish.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'finish-recording' });
  stopTimer();
  statePaused.classList.add('hidden');
  timerEl.className = 'timer';
  $('status-bar-wrap').classList.remove('hidden');
  setStatus('working', t('status_saving', 'Saving recording...'));
});

$('btn-discard').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'discard-recording' });
  stopTimer();
  timerPausedElapsed = 0;
  showState('idle');
});

$('ctl-pause').addEventListener('click', () => {
  $('ctl-pause').disabled = true;
  chrome.runtime.sendMessage({ type: 'upload-pause' });
});
$('ctl-resume').addEventListener('click', () => {
  $('ctl-resume').disabled = true;
  chrome.runtime.sendMessage({ type: 'upload-resume' });
});
$('ctl-cancel').addEventListener('click', () => {
  if (!confirm(t('review_confirmCancelUpload', 'Отменить загрузку? Часть уже загруженных данных будет потеряна.'))) return;
  $('ctl-cancel').disabled = true;
  $('ctl-pause').disabled = true;
  $('ctl-resume').disabled = true;
  chrome.runtime.sendMessage({ type: 'upload-cancel' });
});

/* --- Messages --- */

chrome.runtime.onMessage.addListener((msg) => {
  // Firefox: recording actually started in recorder tab
  if (msg.type === 'firefox-recording-started') {
    chrome.storage.local.get(['recordingStartedAt', 'pausedElapsed'], (s) => {
      timerStartedAt = s.recordingStartedAt || Date.now();
      timerPausedElapsed = s.pausedElapsed || 0;
      showState('recording');
      startTimer();
    });
  }
  // Firefox: recording failed
  if (msg.type === 'recording-failed') {
    showState('idle');
    setStatus('error', t('status_recordingFailed', 'Recording failed'));
  }

  if (msg.type === 'audio-status') {
    recAudioStatus.classList.remove('hidden');
    badgeMic.className = `rec-audio-badge ${msg.mic ? 'on' : 'off'}`;
    badgeSystem.className = `rec-audio-badge ${msg.systemAudio ? 'on' : 'off'}`;
    if (msg.webcam !== undefined) {
      badgeWebcam.classList.remove('hidden');
      badgeWebcam.className = `rec-audio-badge ${msg.webcam ? 'on' : 'off'}`;
    } else {
      badgeWebcam.classList.add('hidden');
    }
  }
  if (msg.type === 'mic-level') {
    if (msg.level >= 0) {
      // Live level during recording — ensure level bar is visible
      micLevelContainer.classList.remove('hidden');
      micLevelContainer.classList.remove('inactive');
      micStatus.classList.add('hidden');
      micLevelBar.style.width = msg.level + '%';
      micLevelBar.style.background = msg.level > 5 ? '#22c55e' : '#475569';
    }
  }
  if (msg.type === 'blob-saved') {
    // Blob saved to IDB — show review state. Background also opens
    // review.html on this same message; keeping the UI flip here so the
    // popup itself reflects 'ready' immediately (status bar hides).
    showState('ready');
  }
  if (msg.type === 'upload-started') setStatus('working', t('status_uploading', 'Uploading...'));
  if (msg.type === 'upload-progress') {
    let label;
    try { label = chrome.i18n.getMessage('status_uploadingPercent', [String(msg.percent)]); } catch { label = ''; }
    if (!label) label = `Uploading ${msg.percent}%`;
    setStatus('working', label);
  }
  if (msg.type === 'upload-chunked-started') {
    $('upload-ctl').classList.remove('hidden');
    $('ctl-pause').classList.remove('hidden');
    $('ctl-resume').classList.add('hidden');
    $('ctl-pause').disabled = false;
    $('ctl-resume').disabled = false;
    $('ctl-cancel').disabled = false;
  }
  if (msg.type === 'upload-pause-state') {
    if (msg.paused) {
      $('ctl-pause').classList.add('hidden');
      $('ctl-resume').classList.remove('hidden');
      $('ctl-resume').disabled = false;
      setStatus('working', t('status_uploadPaused', 'Загрузка на паузе'));
    } else {
      $('ctl-resume').classList.add('hidden');
      $('ctl-pause').classList.remove('hidden');
      $('ctl-pause').disabled = false;
    }
  }
  if (msg.type === 'upload-cancelled') {
    $('upload-ctl').classList.add('hidden');
    setStatus('working', t('status_uploadCancelled', 'Загрузка отменена'));
    setTimeout(() => $('status-bar-wrap').classList.add('hidden'), 2000);
  }
  if (msg.type === 'upload-done') {
    $('upload-ctl').classList.add('hidden');
    showState('idle');
    $('status-bar-wrap').classList.remove('hidden');
    const recUrl = `${SERVER_URL}${DASHBOARD_PATH}recording/${encodeURIComponent(msg.recordingId)}`;
    navigator.clipboard.writeText(recUrl).catch(() => {});
    setStatusWithLink('done', t('status_linkCopied', 'Link copied!'), msg.recordingId);
    loadRecentRecordings();
  }
  if (msg.type === 'upload-error') {
    $('upload-ctl').classList.add('hidden');
    setStatus('error', msg.error);
  }
  if (msg.type === 'recording-stopped-max') {
    stopTimer();
    showState('ready');
    setStatus('working', t('status_maxDuration', 'Max duration reached. Saving...'));
  }
});

/* --- Timer --- */

function startTimer() {
  stopTimer();
  timerEl.classList.remove('inactive', 'paused');
  timerInterval = setInterval(updateTimer, 1000);
  updateTimer();
}

function stopTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
}

function updateTimer() {
  const elapsed = timerPausedElapsed + (Date.now() - timerStartedAt);
  const totalSec = Math.floor(elapsed / 1000);
  timerEl.textContent = `${String(Math.floor(totalSec / 60)).padStart(2, '0')}:${String(totalSec % 60).padStart(2, '0')}`;
}

function showFrozenTimer() {
  const totalSec = Math.floor(timerPausedElapsed / 1000);
  timerEl.textContent = `${String(Math.floor(totalSec / 60)).padStart(2, '0')}:${String(totalSec % 60).padStart(2, '0')}`;
}

/* --- Status --- */

function setStatus(type, text) {
  statusText.textContent = text;
  statusDot.className = 'status-dot';
  statusDot.classList.add({ ready: 'gray', recording: 'red', working: 'yellow', done: 'green', error: 'blue' }[type] || 'gray');
}

function setStatusWithLink(type, text, recordingId) {
  const url = `${SERVER_URL}${DASHBOARD_PATH}recording/${encodeURIComponent(recordingId)}`;
  statusText.innerHTML = `${text} <a href="${url}" class="status-link" id="rec-link">${recordingId}</a>`;
  document.getElementById('rec-link')?.addEventListener('click', (e) => { e.preventDefault(); chrome.tabs.create({ url }); });
  statusDot.className = 'status-dot green';
}

/* --- Recent Recordings --- */
async function loadRecentRecordings() {
  // Without a token, API returns ALL recordings on the server (no user scoping)
  if (!hasExtensionToken) {
    const wrap = $('recent-recordings');
    if (wrap) wrap.classList.add('hidden');
    return;
  }
  try {
    // With token auth, don't filter by author — the token scopes to the user
    const author = hasExtensionToken ? '' : inputAuthor.value;
    const authorParam = author ? `&author=${encodeURIComponent(author)}` : '';
    const headers = {};
    const stored = await chrome.storage.local.get('extensionToken');
    if (stored.extensionToken) {
      headers['Authorization'] = `Bearer ${stored.extensionToken}`;
    }
    const res = await fetch(`${SERVER_URL}/api/recordings?limit=3${authorParam}`, { headers });
    if (!res.ok) return;
    const data = await res.json();
    const list = data.recordings || [];
    const container = $('recent-list');
    const wrap = $('recent-recordings');

    if (!list.length) {
      wrap.classList.add('hidden');
      container.innerHTML = '';
      return;
    }
    wrap.classList.remove('hidden');

    container.innerHTML = list.map(r => {
      const title = r.card_title || r.id;
      let statusClass, statusLabel;
      if (r.status !== 'complete' && r.status !== 'error') {
        statusClass = 'processing'; statusLabel = '...';
      } else if (r.status === 'error') {
        statusClass = 'error'; statusLabel = t('status_err', 'err');
      } else if (r.card_youtrack_id) {
        statusClass = 'complete'; statusLabel = r.card_youtrack_id;
      } else if (r.pending_youtrack_issue_id) {
        statusClass = 'processing'; statusLabel = '\u{1F4CB} ' + t('status_review', 'review');
      } else {
        statusClass = 'complete'; statusLabel = t('status_done', 'done');
      }
      const url = `${SERVER_URL}${DASHBOARD_PATH}recording/${encodeURIComponent(r.id)}`;
      return `<a href="${url}" class="recent-item" data-url="${url}">
        <span class="ri-title">${title.length > 35 ? title.slice(0, 32) + '...' : title}</span>
        <span class="ri-status ${statusClass}">${statusLabel}</span>
      </a>`;
    }).join('');

    container.querySelectorAll('.recent-item').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        chrome.tabs.create({ url: el.dataset.url });
      });
    });
  } catch {}
}

// Mic permission grant button
document.getElementById('grant-mic-btn')?.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: chrome.runtime.getURL('mic-permission.html') });
});

// Recent recordings are loaded inside init() — no need for a duplicate call here.

/* --- Cleanup on popup close --- */
window.addEventListener('pagehide', () => {
  stopMicPreview();
});

/* --- Dashboard link --- */
document.getElementById('dashboard-link')?.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: SERVER_URL + DASHBOARD_PATH });
});

/* --- User badge → open dashboard --- */
document.getElementById('user-connected')?.addEventListener('click', () => {
  chrome.tabs.create({ url: SERVER_URL + DASHBOARD_PATH });
});
