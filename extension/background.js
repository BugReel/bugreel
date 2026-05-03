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

// First install: open setup page + provision a guest account in parallel
// so the user can start recording immediately without copy-pasting tokens.
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('setup.html') });
    // Fire-and-forget: best effort. If the server is unreachable or the build
    // has no preset serverUrl, setup.html falls back to the manual token flow.
    provisionGuestAccount().catch(err => console.log('[BugReel] guest provision failed (non-fatal):', err?.message || err));
  }
});

// Provision a guest user on the configured cloud server, on first install only.
// Branded SaaS builds patch the serverUrl default so this works out of the box.
// Self-hosted/open-source builds with no preset will skip this.
async function provisionGuestAccount() {
  const stored = await chrome.storage.local.get(['extensionToken', 'serverUrl']);
  if (stored.extensionToken) return; // already linked, don't overwrite

  const serverUrl = stored.serverUrl || (await getServerUrl());
  if (!serverUrl) return;

  // Persist serverUrl so content-script-server-bridge can match origin later.
  if (!stored.serverUrl) {
    await chrome.storage.local.set({ serverUrl });
  }

  // Lightweight per-install fingerprint — helps the server cap abuse without
  // identifying the user. Generated once, kept across sessions.
  let deviceId = (await chrome.storage.local.get('deviceId')).deviceId;
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    await chrome.storage.local.set({ deviceId });
  }

  const res = await fetch(`${serverUrl}/api/auth/guest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_id: deviceId }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (!data.ok || !data.token) throw new Error('no token in response');

  const update = {
    extensionToken: data.token,
    userName: data.user?.name || 'Guest',
    userEmail: data.user?.email || '',
    userIsGuest: true,
    serverPlan: data.user?.plan || 'guest',
  };
  if (data.limits?.max_duration_sec) {
    update.serverMaxDurationMin = Math.floor(data.limits.max_duration_sec / 60);
  }
  await chrome.storage.local.set(update);
  console.log('[BugReel] Guest account provisioned');
}

/* ── State ── */
let state = 'idle';
let uploadChunked = false; // true while a chunked upload is in progress (for UI re-hydration)
let uploadPaused = false;
let urlEvents = [];
let consoleEvents = [];
let actionEvents = [];
let manualMarkers = [];
let recordingStartTime = null;
let capturedTabId = null;
let screenInfo = null;
let crmProfile = null;
let recorderTabId = null; // Firefox: tab ID for recorder page
let offscreenLifecycleLock = Promise.resolve(); // serialize create/close to avoid the
                                                 // "closed before fully loading" race when
                                                 // the user double-taps Start

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

/* ── Server-managed limits (plan-based duration, etc.) ── */

let lastLimitsSync = 0;
const LIMITS_SYNC_INTERVAL = 60 * 60 * 1000; // 1 hour

async function syncServerLimits() {
  try {
    const { extensionToken, serverUrl } = await chrome.storage.local.get(['extensionToken', 'serverUrl']);
    if (!extensionToken || !serverUrl) return;

    // Throttle: don't sync more than once per hour
    if (Date.now() - lastLimitsSync < LIMITS_SYNC_INTERVAL) return;

    const res = await fetch(`${serverUrl}/api/auth/me`, {
      headers: { 'Authorization': `Bearer ${extensionToken}` }
    });
    if (!res.ok) return;
    const data = await res.json();
    if (!data.ok || !data.limits) return;

    const update = {};
    if (data.limits.max_duration_sec) {
      update.serverMaxDurationMin = Math.floor(data.limits.max_duration_sec / 60);
    }
    if (data.user?.plan) {
      update.serverPlan = data.user.plan;
    }
    if (Object.keys(update).length) {
      await chrome.storage.local.set(update);
    }
    lastLimitsSync = Date.now();
    console.log('[BugReel] Server limits synced:', update);
  } catch (e) {
    console.log('[BugReel] Server limits sync failed (non-fatal):', e.message);
  }
}

// Sync on service worker startup
syncServerLimits();

/** Resolve effective max duration (minutes): plan limit or user setting */
async function getEffectiveMaxDuration(storage) {
  return storage.serverMaxDurationMin || storage.maxDuration || 10;
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
    let didCreate = false;
    const readyPromise = waitForRecorderReady();
    offscreenLifecycleLock = offscreenLifecycleLock.then(async () => {
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
      didCreate = true;
    });
    await offscreenLifecycleLock;
    // If we just created a fresh offscreen, wait until recorder.js signals
    // ready — otherwise a follow-up sendMessage races the script load.
    if (didCreate) await readyPromise;
    return;
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
    // Chrome: close offscreen document to release mic/streams.
    // Wait after close so macOS releases the mic/displayMedia capture —
    // without this delay, a rapid second recording fails getUserMedia
    // (indicator shows "Mic." as inactive, finalize hangs). Previously
    // the 100ms sleep lived here; commit 0f1ea52 accidentally removed it.
    offscreenLifecycleLock = offscreenLifecycleLock.then(async () => {
      try { await chrome.offscreen.closeDocument(); } catch {}
      await new Promise(r => setTimeout(r, 300));
    });
    return offscreenLifecycleLock;
  }
}

/* ── State management ── */

async function setState(newState, extraStorage = {}) {
  state = newState;
  // Debounce in handleStartRecording keys off recordingStartTime; once we leave
  // an active recording, clear it so the next user-initiated start isn't
  // rejected as a duplicate of the PREVIOUS recording (e.g. a fresh
  // "New recording" click after a 6-second run trips the 3s window).
  if (newState === 'ready' || newState === 'idle') {
    recordingStartTime = 0;
  }
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
  // --- Token handoff from server bridge content-script ---
  // The dashboard page generated a fresh token and posted it; content-script
  // forwarded it here. We accept only if sender is the configured serverUrl.
  if (message.type === 'set-extension-token' && typeof message.token === 'string') {
    (async () => {
      try {
        const { serverUrl } = await chrome.storage.local.get('serverUrl');
        if (!serverUrl || !sender.url) { sendResponse({ ok: false, error: 'no-server-url' }); return; }
        let serverOrigin;
        try { serverOrigin = new URL(serverUrl).origin; } catch { sendResponse({ ok: false, error: 'bad-server-url' }); return; }
        let senderOrigin;
        try { senderOrigin = new URL(sender.url).origin; } catch { sendResponse({ ok: false, error: 'bad-sender' }); return; }
        if (senderOrigin !== serverOrigin) { sendResponse({ ok: false, error: 'origin-mismatch' }); return; }

        const update = {
          extensionToken: message.token,
          userIsGuest: message.user?.is_guest === true,
        };
        if (message.user) {
          if (message.user.name !== undefined) update.userName = message.user.name || '';
          if (message.user.email !== undefined) update.userEmail = message.user.email || '';
          if (message.user.plan) update.serverPlan = message.user.plan;
        }
        await chrome.storage.local.set(update);
        // Trigger limits sync on next opportunity (resets the throttle).
        lastLimitsSync = 0;
        syncServerLimits();
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || 'unknown' });
      }
    })();
    return true; // keep channel open for async sendResponse
  }

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
      // Review page will open when blob-saved is received (avoids race condition)
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
        // Review page will open when blob-saved is received (avoids race condition)
      }
      sendResponse({ success: true });
    })();
    return true;
  }

  if (message.type === 'start-upload') {
    // Must await state restore — service worker may have restarted since recording
    (async () => {
      await ensureStateLoaded();
      if (state !== 'ready') {
        console.warn('[BugReel] start-upload rejected: state=' + state);
        sendResponse({ success: false, error: 'No recording ready' });
        return;
      }
      const segments = message.segments; // [{start, end}, ...] or undefined
      // Read token from storage here — offscreen documents can't access chrome.storage
      const tokenData = await chrome.storage.local.get(['extensionToken', 'serverUrl']);
      await ensureRecorderContext();
      chrome.runtime.sendMessage({
        type: 'offscreen-upload', target: 'offscreen',
        ...buildUploadExtras(),
        segments,
        extensionToken: tokenData.extensionToken || '',
        serverUrl: tokenData.serverUrl || '',
      }).catch(() => {});
      setState('uploading');
      sendResponse({ success: true });
    })();
    return true; // async sendResponse
  }

  if (message.type === 'discard-recording') {
    (async () => {
      const tokenData = await chrome.storage.local.get(['extensionToken', 'serverUrl']);
      // Only forward discard if an offscreen/recorder tab already exists.
      // Creating a fresh offscreen JUST to send "discard" races the next
      // start-recording on the offscreenLifecycleLock — popup triggers
      // discard right before "New recording", and the leftover close chains
      // can clobber the new offscreen. IDB cleanup for the next run already
      // happens inside startRecording (pre-start IDB purge in recorder.js).
      let hasContext = false;
      if (HAS_OFFSCREEN) {
        try {
          const ctx = await chrome.runtime.getContexts({
            contextTypes: ['OFFSCREEN_DOCUMENT'],
            documentUrls: [chrome.runtime.getURL('recorder.html')]
          });
          hasContext = ctx.length > 0;
        } catch {}
      } else {
        hasContext = !!recorderTabId;
      }
      if (hasContext) {
        chrome.runtime.sendMessage({
          type: 'offscreen-discard', target: 'offscreen',
          extensionToken: tokenData.extensionToken || '',
          serverUrl: tokenData.serverUrl || '',
        }).catch(() => {});
        closeRecorderContext();
      }
      setState('idle');
    })();
    sendResponse({ success: true });
    return false;
  }

  // Relay upload control messages from review page → offscreen recorder
  if (message.type === 'upload-pause' || message.type === 'upload-resume' || message.type === 'upload-cancel') {
    const targetType =
      message.type === 'upload-pause'  ? 'offscreen-upload-pause'  :
      message.type === 'upload-resume' ? 'offscreen-upload-resume' :
                                         'offscreen-upload-cancel';
    chrome.runtime.sendMessage({ type: targetType, target: 'offscreen' }).catch(() => {});
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
        uploadChunked,
        uploadPaused,
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
    'upload-chunked-started', 'upload-pause-state', 'upload-cancelled',
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
    if (message.type === 'upload-chunked-started') {
      uploadChunked = true;
      uploadPaused = false;
    }
    if (message.type === 'upload-pause-state') {
      uploadPaused = !!message.paused;
    }
    if (message.type === 'upload-done' || message.type === 'upload-error' || message.type === 'upload-cancelled') {
      uploadChunked = false;
      uploadPaused = false;
    }
    if (message.type === 'upload-cancelled') {
      setState('idle');
      closeRecorderContext();
    }
    if (message.type === 'blob-saved') {
      if (state === 'ready') {
        // Blob is now in IDB — open review page first, THEN close recorder tab.
        // Firefox: closing the recorder tab too early can lose IDB data that hasn't flushed.
        chrome.tabs.create({ url: chrome.runtime.getURL('review.html'), active: true }).catch(() => {});
        // Delay tab cleanup so IDB has time to fully persist
        setTimeout(() => closeRecorderContext(), IS_FIREFOX ? 1500 : 0);
      } else if (state === 'uploading') {
        closeRecorderContext();
        ensureRecorderContext().then(() => {
          chrome.runtime.sendMessage({ type: 'offscreen-upload', target: 'offscreen', ...buildUploadExtras() }).catch(() => {});
        });
      } else {
        closeRecorderContext();
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

  console.log('[BugReel] Starting recording: mode=' + mode + ' mic=' + micEnabled + ' sys=' + systemAudioEnabled + ' webcam=' + webcamEnabled + ' prevState=' + state);

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
    // Chrome: close existing offscreen first, then create new one.
    // Serialized via offscreenLifecycleLock so a second start-click can't
    // interleave its close+create with ours and trigger
    // "Offscreen document closed before fully loading".
    const reasons = (mode === 'desktop' || !streamId)
      ? ['USER_MEDIA', 'DISPLAY_MEDIA']
      : ['USER_MEDIA'];
    offscreenLifecycleLock = offscreenLifecycleLock.then(async () => {
      try {
        const before = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
        console.log('[BugReel] Offscreen pre-close contexts:', before.length);
      } catch {}
      try { await chrome.offscreen.closeDocument(); console.log('[BugReel] closeDocument ok'); }
      catch (e) { console.log('[BugReel] closeDocument skipped:', e && e.message); }
      // macOS needs a beat after closeDocument to fully release mic/display
      // capture devices — without it, the next getUserMedia call in the new
      // recorder context times out and we lose the mic indicator entirely.
      await new Promise(r => setTimeout(r, 300));
      await chrome.offscreen.createDocument({
        url: 'recorder.html',
        reasons,
        justification: 'Recording capture stream with MediaRecorder'
      });
      console.log('[BugReel] createDocument ok');
      try {
        const after = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
        console.log('[BugReel] Offscreen post-create contexts:', after.length);
      } catch {}
    });
    await offscreenLifecycleLock;
    // Readiness of recorder.js is handled by the sendMessage retry loop
    // below — no need for a separate ready-signal, which is flaky across
    // rapid close+create cycles on Chrome.
  } else {
    // Firefox: create recorder tab (active: true for getDisplayMedia permission)
    if (recorderTabId) {
      try { await chrome.tabs.remove(recorderTabId); } catch {}
      recorderTabId = null;
    }
    // Sync server limits before recording (Firefox path)
    await syncServerLimits();

    // Save params to storage — recorder tab reads them and handles capture with user gesture
    const serverUrl_ = await getServerUrl();
    const storage_ = await chrome.storage.local.get(['author', 'extensionToken', 'userName', 'userEmail', 'maxDuration', 'videoQuality', 'webcamPosition', 'serverMaxDurationMin']);
    const effectiveMaxDuration_ = await getEffectiveMaxDuration(storage_);
    await chrome.storage.local.set({
      recorderParams: {
        serverUrl: serverUrl_,
        author: storage_.extensionToken ? (storage_.userName || storage_.userEmail || 'unknown') : (storage_.author || 'unknown'),
        mode, micEnabled, systemAudioEnabled, streamId,
        webcamEnabled, webcamDeviceId,
        webcamPosition: storage_.webcamPosition || null,
        extensionToken: storage_.extensionToken || '',
        maxDuration: effectiveMaxDuration_,
        videoQuality: storage_.videoQuality || '720p',
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

  // Sync server limits before recording (non-blocking if recently synced)
  await syncServerLimits();

  const serverUrl = await getServerUrl();
  const storage = await chrome.storage.local.get(['author', 'extensionToken', 'userName', 'userEmail', 'maxDuration', 'videoQuality', 'webcamPosition', 'serverMaxDurationMin']);
  const author = storage.extensionToken ? (storage.userName || storage.userEmail || 'unknown') : (storage.author || 'unknown');
  const effectiveMaxDuration = await getEffectiveMaxDuration(storage);

  console.log('[BugReel] Sending offscreen-start to recorder...');
  const startPayload = {
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
    maxDuration: effectiveMaxDuration,
    videoQuality: storage.videoQuality || '720p',
  };
  // Retry until offscreen responds: recorder-ready signal races the script
  // load (Chrome occasionally drops the first message from a fresh offscreen,
  // especially when close+create are back-to-back). We keep trying until we
  // get a real object back, so startRecording actually runs in the recorder.
  let offscreenResult;
  let lastErr = null;
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      offscreenResult = await chrome.runtime.sendMessage(startPayload);
    } catch (e) {
      lastErr = e && e.message;
    }
    if (offscreenResult !== undefined) break;
    if (attempt === 0 || attempt === 9 || attempt === 19) {
      console.log('[BugReel] offscreen-start attempt ' + attempt + ' got undefined (lastErr=' + lastErr + ')');
    }
    await new Promise(r => setTimeout(r, 150));
  }
  console.log('[BugReel] Recorder response:', offscreenResult);
  if (offscreenResult === undefined) {
    state = 'idle';
    closeRecorderContext();
    return { success: false, error: 'Recorder did not respond after 3s' };
  }

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

  const startedAt = Date.now();
  await setState('recording', { recordingStartedAt: startedAt, pausedElapsed: 0 });

  console.log('[BugReel] Recording started successfully');
  return { success: true };
}
