/* background.js — BugReel (Chrome service worker + Firefox background script)
 * State machine: idle → recording → paused → ready → uploading → idle
 *
 * Cross-browser: detects Chrome (offscreen API + tabCapture) vs Firefox (tab + getDisplayMedia)
 */

/* ── Platform detection ── */
const IS_FIREFOX = typeof browser !== 'undefined' && !!browser.runtime?.getBrowserInfo;
const HAS_TAB_CAPTURE = typeof chrome !== 'undefined' && !!chrome.tabCapture;
const HAS_OFFSCREEN = typeof chrome !== 'undefined' && !!chrome.offscreen;

console.log('[BugReel] Platform:', IS_FIREFOX ? 'Firefox' : 'Chrome', '| tabCapture:', HAS_TAB_CAPTURE, '| offscreen:', HAS_OFFSCREEN);

// First install: open setup page
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('setup.html') });
  }
});

/* ── State ── */
let state = 'idle';
let urlEvents = [];
let consoleEvents = [];
let actionEvents = [];
let manualMarkers = [];
let recordingStartTime = null;
let capturedTabId = null;
let screenInfo = null;
let crmProfile = null;
let recorderTabId = null; // Firefox: tab ID for recorder page

// Restore state from storage on service worker wake-up
async function ensureStateLoaded() {
  const s = await chrome.storage.local.get(['extensionState', 'recordingStartedAt', 'manualMarkersData']);
  if (s.extensionState) state = s.extensionState;
  if (s.recordingStartedAt && (state === 'recording' || state === 'paused')) {
    recordingStartTime = s.recordingStartedAt;
  }
  if (s.manualMarkersData) {
    try { manualMarkers = JSON.parse(s.manualMarkersData); } catch {}
  }
}
ensureStateLoaded();

// Global hotkey: mark screenshot timecode
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'mark-screenshot') {
    await ensureStateLoaded();
    if (!recordingStartTime) return;
    manualMarkers.push({ ts: +elapsedSeconds().toFixed(1) });
    chrome.storage.local.set({ manualMarkersCount: manualMarkers.length, manualMarkersData: JSON.stringify(manualMarkers) });
    chrome.action.setBadgeText({ text: '📷' });
    chrome.action.setBadgeBackgroundColor({ color: '#22c55e' });
    setTimeout(() => {
      const badges = { recording: { text: 'REC', color: '#dc2626' }, paused: { text: '||', color: '#f59e0b' } };
      const badge = badges[state];
      chrome.action.setBadgeText({ text: badge?.text || '' });
      if (badge) chrome.action.setBadgeBackgroundColor({ color: badge.color });
    }, 800);
  }
});

// Notification click → open recording page
chrome.notifications.onClicked.addListener(async (notifId) => {
  const serverUrl = await getServerUrl();
  const stored = await chrome.storage.local.get('dashboardPath');
  const dashPath = stored.dashboardPath || '/';
  const url = `${serverUrl}${dashPath}recording/${encodeURIComponent(notifId)}`;
  chrome.tabs.create({ url });
  chrome.notifications.clear(notifId);
});

// Firefox: handle recorder tab being closed by user
if (IS_FIREFOX) {
  chrome.tabs.onRemoved.addListener((tabId) => {
    if (tabId === recorderTabId) {
      console.log('[BugReel] Recorder tab closed by user');
      recorderTabId = null;
      if (state === 'recording' || state === 'paused') {
        setState('idle');
      }
    }
  });
}

/* ── Helpers ── */

async function getServerUrl() {
  const r = await chrome.storage.local.get('serverUrl');
  return r.serverUrl || '';
}

function elapsedSeconds() {
  return recordingStartTime ? (Date.now() - recordingStartTime) / 1000 : 0;
}

/* ── URL/request tracking ── */

function onTabActivated({ tabId }) {
  if (!recordingStartTime) return;
  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError || !tab?.url) return;
    urlEvents.push({ ts: +elapsedSeconds().toFixed(1), url: tab.url, title: tab.title || '', type: 'tab_switch' });
  });
}

function onTabUpdated(tabId, changeInfo, tab) {
  if (!recordingStartTime) return;
  if (!changeInfo.url) return;
  if (capturedTabId && tabId !== capturedTabId) return;
  urlEvents.push({ ts: +elapsedSeconds().toFixed(1), url: changeInfo.url, title: tab.title || '', type: 'navigation' });
}

function onRequestCompleted(details) {
  if (!recordingStartTime) return;
  if (details.statusCode < 400) return;
  if (capturedTabId && details.tabId !== capturedTabId && details.tabId !== -1) return;
  try {
    const pathname = new URL(details.url).pathname;
    consoleEvents.push({
      ts: +elapsedSeconds().toFixed(1),
      level: details.statusCode >= 500 ? 'error' : 'warning',
      text: `${details.method} ${pathname} → ${details.statusCode}`,
      source: 'network',
      url: details.url
    });
  } catch (e) { /* invalid URL, skip */ }
}

function startTrackingListeners() {
  chrome.tabs.onActivated.addListener(onTabActivated);
  chrome.tabs.onUpdated.addListener(onTabUpdated);
  if (chrome.webRequest?.onCompleted) {
    chrome.webRequest.onCompleted.addListener(onRequestCompleted, { urls: ['<all_urls>'] });
  }
}

function buildUploadExtras() {
  const meta = {
    userAgent: navigator.userAgent,
    platform: navigator.platform || navigator.userAgentData?.platform || '',
    language: navigator.language,
    timestamp: new Date().toISOString()
  };
  if (screenInfo) {
    meta.screenWidth = screenInfo.width;
    meta.screenHeight = screenInfo.height;
    meta.devicePixelRatio = screenInfo.devicePixelRatio;
    meta.innerWidth = screenInfo.innerWidth;
    meta.innerHeight = screenInfo.innerHeight;
  }
  if (crmProfile) {
    meta.crmProfile = crmProfile;
  }
  return {
    urlEvents: JSON.stringify(urlEvents),
    consoleEvents: JSON.stringify(consoleEvents),
    actionEvents: JSON.stringify(actionEvents),
    manualMarkers: JSON.stringify(manualMarkers),
    metadata: JSON.stringify(meta)
  };
}

/* ── Recorder context management ── */

function waitForRecorderReady() {
  return new Promise(resolve => {
    const handler = (msg) => {
      if (msg.type === 'recorder-ready') {
        console.log('[BugReel] Recorder ready signal received');
        chrome.runtime.onMessage.removeListener(handler);
        resolve();
      }
    };
    chrome.runtime.onMessage.addListener(handler);
    setTimeout(() => {
      console.log('[BugReel] Recorder ready timeout (5s)');
      chrome.runtime.onMessage.removeListener(handler);
      resolve();
    }, 5000);
  });
}

async function ensureRecorderContext() {
  if (HAS_OFFSCREEN) {
    // Chrome: offscreen document
    try {
      const ctx = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [chrome.runtime.getURL('recorder.html')]
      });
      if (ctx.length > 0) return;
    } catch {}
    await chrome.offscreen.createDocument({
      url: 'recorder.html',
      reasons: ['USER_MEDIA', 'DISPLAY_MEDIA'],
      justification: 'Recording capture stream with MediaRecorder'
    });
  } else {
    // Firefox: background tab with recorder page
    if (recorderTabId) {
      try {
        await chrome.tabs.get(recorderTabId);
        return; // Tab still exists
      } catch {
        recorderTabId = null;
      }
    }
    console.log('[BugReel] Creating recorder tab...');
    const readyPromise = waitForRecorderReady();
    const tab = await chrome.tabs.create({
      url: chrome.runtime.getURL('recorder.html'),
      active: false // Don't steal focus — keeps popup open
    });
    recorderTabId = tab.id;
    console.log('[BugReel] Recorder tab created:', tab.id);
    await readyPromise;
  }
}

async function closeRecorderContext() {
  if (IS_FIREFOX && recorderTabId) {
    console.log('[BugReel] Closing recorder tab:', recorderTabId);
    try { await chrome.tabs.remove(recorderTabId); } catch {}
    recorderTabId = null;
  } else if (HAS_OFFSCREEN) {
    // Chrome: close offscreen document to release mic/streams
    try { await chrome.offscreen.closeDocument(); } catch {}
  }
}

/* ── State management ── */

async function setState(newState, extraStorage = {}) {
  state = newState;
  await chrome.storage.local.set({ extensionState: newState, ...extraStorage });

  const badges = {
    recording:  { text: 'REC', color: '#dc2626' },
    paused:     { text: '||',  color: '#f59e0b' },
    ready:      { text: '✓',   color: '#22c55e' },
    uploading:  { text: '↑',   color: '#3b82f6' },
  };
  const badge = badges[newState];
  chrome.action.setBadgeText({ text: badge?.text || '' });
  if (badge) chrome.action.setBadgeBackgroundColor({ color: badge.color });
}

/* ── Message handling ── */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // --- Console events from content script ---
  if (message.type === 'console-event' && recordingStartTime) {
    consoleEvents.push({
      ts: +elapsedSeconds().toFixed(1),
      level: message.level,
      text: (message.text || '').slice(0, 500),
      source: message.source || 'unknown',
      stack: message.stack || ''
    });
    return;
  }

  // --- Manual screenshot marker from widget ---
  if (message.type === 'manual-marker' && recordingStartTime) {
    manualMarkers.push({ ts: +elapsedSeconds().toFixed(1) });
    chrome.storage.local.set({ manualMarkersCount: manualMarkers.length, manualMarkersData: JSON.stringify(manualMarkers) });
    return;
  }

  // --- Webcam position update from widget ---
  if (message.type === 'webcam-position-update') {
    // Store for future recordings and forward to active recorder
    chrome.storage.local.set({ webcamPosition: { xPercent: message.xPercent, yPercent: message.yPercent } });
    chrome.runtime.sendMessage({ ...message, target: 'offscreen' }).catch(() => {});
    return;
  }

  // --- CRM profile from content script ---
  if (message.type === 'crm-profile' && message.profile) {
    crmProfile = message.profile;
    return;
  }

  // --- Action events from content script ---
  if (message.type === 'action-event' && recordingStartTime) {
    actionEvents.push({
      ts: +elapsedSeconds().toFixed(1),
      eventType: message.eventType || 'click',
      tag: message.tag || '',
      id: message.id || '',
      role: message.role || '',
      ariaLabel: (message.ariaLabel || '').slice(0, 60),
      text: (message.text || '').slice(0, 80),
      path: (message.path || '').slice(0, 120),
      ...(message.action ? { action: message.action } : {}),
      ...(message.method ? { method: message.method } : {}),
    });
    return;
  }

  // --- Recorder ready signal (handled by waitForRecorderReady) ---
  if (message.type === 'recorder-ready') {
    return;
  }

  // --- Firefox: recording actually started in recorder tab ---
  if (message.type === 'firefox-recording-started') {
    console.log('[BugReel] Firefox: recording confirmed by recorder tab');
    recordingStartTime = Date.now();
    startTrackingListeners();
    setState('recording', { recordingStartedAt: recordingStartTime, pausedElapsed: 0 });
    return;
  }

  // --- Firefox: recording failed in recorder tab ---
  if (message.type === 'recording-failed') {
    console.log('[BugReel] Recording failed in recorder tab, reverting to idle');
    setState('idle');
    return;
  }

  // --- Commands from popup/review ---
  if (message.type === 'start-recording') {
    if (message.screenInfo) screenInfo = message.screenInfo;
    handleStartRecording(message.tabId, message.mode, message.micEnabled, message.systemAudioEnabled, message.webcamEnabled, message.webcamDeviceId)
      .then(r => { try { sendResponse(r); } catch {} })
      .catch(e => {
        console.error('[BugReel] handleStartRecording error:', e);
        state = 'idle'; // Reset state on error
        try { sendResponse({ success: false, error: e.message }); } catch {}
      });
    return true;
  }

  if (message.type === 'pause-recording') {
    (async () => {
      await ensureStateLoaded();
      if (state !== 'recording') { sendResponse({ success: false, error: 'Not recording' }); return; }
      chrome.runtime.sendMessage({ type: 'offscreen-pause', target: 'offscreen' }).catch(() => {});
      const now = Date.now();
      const s = await chrome.storage.local.get(['recordingStartedAt', 'pausedElapsed']);
      const elapsed = (s.pausedElapsed || 0) + (now - (s.recordingStartedAt || now));
      await setState('paused', { pausedElapsed: elapsed, pausedAt: now });
      sendResponse({ success: true });
    })();
    return true;
  }

  if (message.type === 'resume-recording') {
    (async () => {
      await ensureStateLoaded();
      if (state !== 'paused') { sendResponse({ success: false, error: 'Not paused' }); return; }
      chrome.runtime.sendMessage({ type: 'offscreen-resume', target: 'offscreen' }).catch(() => {});
      await setState('recording', { recordingStartedAt: Date.now() });
      sendResponse({ success: true });
    })();
    return true;
  }

  if (message.type === 'finish-recording') {
    if (state !== 'recording' && state !== 'paused') return sendResponse({ success: false, error: 'Not recording' });
    chrome.runtime.sendMessage({ type: 'offscreen-finish', target: 'offscreen' }).catch(() => {});
    (async () => {
      await setState('ready');
      // Auto-open review page
      chrome.tabs.create({ url: chrome.runtime.getURL('review.html'), active: true }).catch(() => {});
      sendResponse({ success: true });
    })();
    return true;
  }

  if (message.type === 'stop-and-upload') {
    (async () => {
      await ensureStateLoaded();
      if (state !== 'recording' && state !== 'paused') {
        sendResponse({ success: false, error: 'Not recording' });
        return;
      }
      // Check user preference: review first or auto-upload
      const prefs = await chrome.storage.local.get('afterRecording');
      if (prefs.afterRecording === 'auto-upload') {
        chrome.runtime.sendMessage({
          type: 'offscreen-finish', target: 'offscreen',
          autoUpload: true, ...buildUploadExtras()
        }).catch(() => {});
        await setState('uploading');
      } else {
        // Default: save blob and go to review screen
        chrome.runtime.sendMessage({ type: 'offscreen-finish', target: 'offscreen' }).catch(() => {});
        await setState('ready');
        // Auto-open review page so user doesn't have to guess
        chrome.tabs.create({ url: chrome.runtime.getURL('review.html'), active: true }).catch(() => {});
      }
      sendResponse({ success: true });
    })();
    return true;
  }

  if (message.type === 'start-upload') {
    if (state !== 'ready') return sendResponse({ success: false, error: 'No recording ready' });
    const segments = message.segments; // [{start, end}, ...] or undefined
    ensureRecorderContext().then(() => {
      chrome.runtime.sendMessage({
        type: 'offscreen-upload', target: 'offscreen',
        ...buildUploadExtras(),
        segments
      }).catch(() => {});
      setState('uploading');
    });
    sendResponse({ success: true });
    return false;
  }

  if (message.type === 'discard-recording') {
    ensureRecorderContext().then(() => {
      chrome.runtime.sendMessage({ type: 'offscreen-discard', target: 'offscreen' }).catch(() => {});
      setState('idle');
      closeRecorderContext();
    });
    sendResponse({ success: true });
    return false;
  }

  if (message.type === 'get-status') {
    chrome.storage.local.get(['recordingStartedAt', 'pausedElapsed', 'pausedAt'], (s) => {
      sendResponse({
        state: state,
        recordingStartedAt: s.recordingStartedAt,
        pausedElapsed: s.pausedElapsed || 0,
        pausedAt: s.pausedAt,
        isFirefox: IS_FIREFOX,
      });
    });
    return true;
  }

  // --- Mic preview ---
  if (message.type === 'mic-preview-start') {
    if (IS_FIREFOX) {
      sendResponse({ ok: true });
      return false;
    }
    ensureRecorderContext().then(() => {
      chrome.runtime.sendMessage({ ...message, target: 'offscreen' }).catch(() => {});
    });
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === 'mic-preview-stop') {
    if (IS_FIREFOX) {
      sendResponse({ ok: true });
      return false;
    }
    // Stop mic preview and close offscreen if not recording (releases mic indicator)
    if (HAS_OFFSCREEN) {
      chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [chrome.runtime.getURL('recorder.html')]
      }).then(ctx => {
        if (ctx.length > 0) {
          chrome.runtime.sendMessage({ ...message, target: 'offscreen' }).catch(() => {});
          if (state === 'idle') {
            setTimeout(() => closeRecorderContext(), 300);
          }
        }
      }).catch(() => {});
    }
    sendResponse({ ok: true });
    return false;
  }

  // --- Relay from recorder to popup/review ---
  if ([
    'upload-started', 'upload-done', 'upload-error', 'upload-progress',
    'recording-stopped-max', 'audio-status', 'mic-level', 'blob-saved',
    'firefox-recording-started'
  ].includes(message.type)) {
    if (message.type === 'recording-stopped-max') {
      setState('ready');
    }
    if (message.type === 'upload-done') {
      setState('idle');
      closeRecorderContext();
      const recId = message.recordingId || 'unknown';
      chrome.notifications.create(recId, {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'Video uploaded',
        message: `${recId} — link copied to clipboard`,
      });
    }
    if (message.type === 'upload-error' && state === 'uploading') {
      setState('ready');
    }
    if (message.type === 'blob-saved') {
      closeRecorderContext();
      if (state === 'uploading') {
        ensureRecorderContext().then(() => {
          chrome.runtime.sendMessage({ type: 'offscreen-upload', target: 'offscreen', ...buildUploadExtras() }).catch(() => {});
        });
      }
    }
    chrome.runtime.sendMessage(message).catch(() => {});
    return false;
  }
});

/* ── Start recording ── */

async function handleStartRecording(tabId, mode, micEnabled = true, systemAudioEnabled = true, webcamEnabled = false, webcamDeviceId = '') {
  if (state === 'recording' || state === 'paused' || state === 'starting') {
    return { success: false, error: 'Already recording or starting' };
  }

  // Debounce: prevent duplicate starts within 3 seconds (service worker may restart)
  const now = Date.now();
  if (now - recordingStartTime < 3000 && recordingStartTime > 0) {
    console.warn('[BugReel] Duplicate start rejected (debounce)');
    return { success: false, error: 'Recording just started' };
  }

  state = 'starting'; // Prevent duplicate starts during async setup

  console.log('[BugReel] Starting recording: mode=' + mode + ' mic=' + micEnabled + ' sys=' + systemAudioEnabled + ' webcam=' + webcamEnabled);

  // Reset tracking state
  urlEvents = [];
  consoleEvents = [];
  actionEvents = [];
  manualMarkers = [];
  crmProfile = null;
  chrome.storage.local.set({ manualMarkersCount: 0, manualMarkersData: '[]' });
  recordingStartTime = Date.now();
  capturedTabId = (mode === 'tab' && tabId) ? tabId : null;

  // Chrome tab mode: get streamId via tabCapture API
  // Firefox: streamId stays undefined → recorder uses getDisplayMedia
  let streamId;
  if (mode === 'tab' && HAS_TAB_CAPTURE) {
    streamId = await new Promise((resolve, reject) => {
      chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (id) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(id);
      });
    });
  }

  // Create recorder context
  if (HAS_OFFSCREEN) {
    // Chrome: close existing offscreen first, then create new one
    try {
      await chrome.offscreen.closeDocument();
      await new Promise(r => setTimeout(r, 100)); // Wait for cleanup
    } catch {}
    const reasons = (mode === 'desktop' || !streamId)
      ? ['USER_MEDIA', 'DISPLAY_MEDIA']
      : ['USER_MEDIA'];
    await chrome.offscreen.createDocument({
      url: 'recorder.html',
      reasons,
      justification: 'Recording capture stream with MediaRecorder'
    });
  } else {
    // Firefox: create recorder tab (active: true for getDisplayMedia permission)
    if (recorderTabId) {
      try { await chrome.tabs.remove(recorderTabId); } catch {}
      recorderTabId = null;
    }
    // Save params to storage — recorder tab reads them and handles capture with user gesture
    const serverUrl_ = await getServerUrl();
    const storage_ = await chrome.storage.local.get(['author', 'extensionToken', 'userName', 'userEmail']);
    await chrome.storage.local.set({
      recorderParams: {
        serverUrl: serverUrl_,
        author: storage_.extensionToken ? (storage_.userName || storage_.userEmail || 'unknown') : (storage_.author || 'unknown'),
        mode, micEnabled, systemAudioEnabled, streamId,
        webcamEnabled, webcamDeviceId,
        extensionToken: storage_.extensionToken || ''
      }
    });
    console.log('[BugReel] Creating recorder tab (active)...');
    const tab = await chrome.tabs.create({
      url: chrome.runtime.getURL('recorder.html'),
      active: true // Must be active for getDisplayMedia
    });
    recorderTabId = tab.id;
    console.log('[BugReel] Recorder tab created:', tab.id);

    // Don't set recording state yet — wait for recorder tab to confirm capture started
    // Recorder sends 'firefox-recording-started' when getDisplayMedia succeeds
    return { success: true };
  }

  const serverUrl = await getServerUrl();
  const storage = await chrome.storage.local.get(['author', 'extensionToken', 'userName', 'userEmail', 'maxDuration', 'videoQuality', 'webcamPosition']);
  const author = storage.extensionToken ? (storage.userName || storage.userEmail || 'unknown') : (storage.author || 'unknown');

  console.log('[BugReel] Sending offscreen-start to recorder...');
  const offscreenResult = await chrome.runtime.sendMessage({
    type: 'offscreen-start',
    target: 'offscreen',
    streamId,
    serverUrl,
    author,
    mode,
    micEnabled,
    systemAudioEnabled,
    webcamEnabled,
    webcamDeviceId,
    webcamPosition: storage.webcamPosition || null,
    extensionToken: storage.extensionToken || '',
    maxDuration: storage.maxDuration || 10,
    videoQuality: storage.videoQuality || '720p',
  });

  console.log('[BugReel] Recorder response:', offscreenResult);

  if (offscreenResult && !offscreenResult.success) {
    state = 'idle';
    closeRecorderContext();
    return { success: false, error: offscreenResult.error || 'Recorder failed to start' };
  }

  // Capture initial URL
  if (tabId) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab?.url) {
        urlEvents.push({ ts: 0, url: tab.url, title: tab.title || '', type: 'initial' });
      }
    } catch (e) { /* tab may not exist */ }
  }

  startTrackingListeners();

  const now = Date.now();
  await setState('recording', { recordingStartedAt: now, pausedElapsed: 0 });

  console.log('[BugReel] Recording started successfully');
  return { success: true };
}
