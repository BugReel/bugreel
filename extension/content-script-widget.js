(() => {
  const WIDGET_ID = 'bugreel-widget';
  let host = null;
  let shadow = null;
  let timerEl = null;
  let timerInterval = null;
  let state = { extensionState: 'idle', recordingStartedAt: 0, pausedElapsed: 0, pausedAt: 0 };
  let dragState = null;
  let webcamStream = null;
  let webcamVisible = true;

  /** i18n helper — returns translated string or fallback */
  const t = (key, fallback) => {
    try { return chrome.i18n?.getMessage(key) || fallback || key; }
    catch { return fallback || key; }
  };

  function formatTime(ms) {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  function send(msg) {
    try { chrome.runtime.sendMessage(msg).catch(() => removeWidget()); }
    catch { removeWidget(); }
  }

  function startTimer() {
    stopTimer();
    timerInterval = setInterval(updateTimer, 1000);
    updateTimer();
  }

  function stopTimer() {
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  }

  function updateTimer() {
    if (!timerEl) return;
    const elapsed = state.pausedElapsed + (Date.now() - state.recordingStartedAt);
    timerEl.textContent = formatTime(elapsed);
  }

  function showFrozenTimer() {
    if (timerEl) timerEl.textContent = formatTime(state.pausedElapsed);
  }

  async function startWebcamPreview() {
    if (!shadow || webcamStream) return;
    try {
      const stored = await new Promise(r => chrome.storage.local.get(['webcamEnabled', 'webcamDeviceId'], r));
      if (!stored.webcamEnabled) return;
      const constraints = {
        video: stored.webcamDeviceId ? { deviceId: { exact: stored.webcamDeviceId } } : true,
        audio: false,
      };
      webcamStream = await navigator.mediaDevices.getUserMedia(constraints);
      const videoEl = shadow.querySelector('.webcam-video');
      const wrap = shadow.querySelector('.webcam-wrap');
      if (videoEl && wrap) {
        videoEl.srcObject = webcamStream;
        wrap.classList.remove('hidden');
        webcamVisible = true;
        const btnCam = shadow.querySelector('.btn-cam');
        if (btnCam) btnCam.classList.add('active');
      }
    } catch (e) {
      console.warn('[BugReel] Widget webcam preview failed:', e.message);
    }
  }

  function stopWebcamPreview() {
    if (webcamStream) {
      webcamStream.getTracks().forEach(t => t.stop());
      webcamStream = null;
    }
    if (shadow) {
      const videoEl = shadow.querySelector('.webcam-video');
      if (videoEl) videoEl.srcObject = null;
      const wrap = shadow.querySelector('.webcam-wrap');
      if (wrap) wrap.classList.add('hidden');
    }
  }

  function toggleWebcamPreview() {
    if (!shadow) return;
    const wrap = shadow.querySelector('.webcam-wrap');
    const btnCam = shadow.querySelector('.btn-cam');
    if (!wrap) return;

    if (webcamVisible && webcamStream) {
      // Hide preview (stream keeps running for compositing in recorder)
      wrap.classList.add('hidden');
      webcamVisible = false;
      if (btnCam) btnCam.classList.remove('active');
    } else if (!webcamStream) {
      // Start preview for the first time
      startWebcamPreview();
    } else {
      // Show preview again
      wrap.classList.remove('hidden');
      webcamVisible = true;
      if (btnCam) btnCam.classList.add('active');
    }
  }

  function removeWidget() {
    stopTimer();
    stopWebcamPreview();
    if (host && host.parentNode) host.parentNode.removeChild(host);
    host = null; shadow = null; timerEl = null;
  }

  function createWidget() {
    if (host) return;
    host = document.createElement('div');
    host.id = WIDGET_ID;
    host.style.cssText = 'position:fixed;z-index:2147483647;bottom:24px;left:24px;';
    shadow = host.attachShadow({ mode: 'closed' });

    shadow.innerHTML = `
<style>
  :host { all: initial; }
  .widget {
    display: flex; align-items: center; gap: 8px;
    padding: 6px 10px;
    background: #0e1525; border: 1px solid #1e2d48; border-radius: 12px;
    box-shadow: 0 4px 24px rgba(0,0,0,0.5);
    backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
    opacity: 0.9; transition: opacity 0.15s;
    cursor: grab; user-select: none; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  }
  .widget:hover { opacity: 1; }
  .widget.dragging { cursor: grabbing; opacity: 1; }

  .dot {
    width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0;
  }
  .dot.rec { background: #dc2626; animation: pulse 1.2s ease-in-out infinite; }
  .dot.paused { background: #f59e0b; animation: blink 1s step-end infinite; }
  @keyframes pulse { 0%,100% { opacity:1; box-shadow:0 0 0 0 rgba(220,38,38,0.5); } 50% { opacity:0.6; box-shadow:0 0 0 4px rgba(220,38,38,0); } }
  @keyframes blink { 0%,100% { opacity:1; } 50% { opacity:0; } }

  .time {
    font-size: 14px; font-weight: 600; color: #f1f5f9;
    font-variant-numeric: tabular-nums; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    min-width: 32px;
  }

  .btn {
    width: 28px; height: 28px; border-radius: 50%; border: none;
    display: flex; align-items: center; justify-content: center;
    cursor: pointer; transition: transform 0.1s, opacity 0.1s; flex-shrink: 0; padding: 0;
  }
  .btn:hover { transform: scale(1.1); }
  .btn:active { transform: scale(0.95); }
  .btn svg { width: 12px; height: 12px; }

  .btn-pause { background: #f59e0b; }
  .btn-pause svg { fill: #000; }
  .btn-resume { background: #dc2626; }
  .btn-resume svg { fill: #fff; }
  .btn-stop { background: #1e2d48; }
  .btn-stop svg { fill: #94a3b8; }
  .btn-mark { background: #1e2d48; position: relative; }
  .btn-mark svg { fill: #94a3b8; }
  .btn-mark.flash { background: #22c55e; animation: markflash 0.6s ease-out forwards; }
  .btn-mark.flash svg { fill: #fff; }
  @keyframes markflash { 0% { background:#22c55e; transform:scale(1.2); } 100% { background:#1e2d48; transform:scale(1); } }
  .mark-count {
    position: absolute; top: -4px; right: -4px;
    background: #22c55e; color: #000; font-size: 9px; font-weight: 700;
    min-width: 14px; height: 14px; border-radius: 7px;
    display: none; align-items: center; justify-content: center; padding: 0 2px;
    font-family: ui-monospace, monospace; line-height: 1;
  }
  .mark-count.visible { display: flex; }

  .webcam-wrap {
    display: flex; justify-content: center; margin-bottom: 8px;
  }
  .webcam-video {
    width: 120px; height: 120px; border-radius: 50%;
    object-fit: cover; border: 2px solid rgba(255,255,255,0.2);
    box-shadow: 0 4px 16px rgba(0,0,0,0.6); background: #000;
  }
  .webcam-wrap.hidden { display: none; }

  .btn-cam { background: #1e2d48; }
  .btn-cam svg { fill: #94a3b8; }
  .btn-cam.active svg { fill: #22c55e; }
</style>
<div class="webcam-wrap hidden"><video class="webcam-video" autoplay playsinline muted></video></div>
<div class="widget">
  <span class="dot"></span>
  <span class="time">0:00</span>
  <button class="btn btn-mark" title="${t('widget_titleMark', 'Mark screenshot')} (⌘⇧S)">
    <svg viewBox="0 0 24 24"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
    <span class="mark-count"></span>
  </button>
  <button class="btn btn-toggle" title="${t('widget_titlePause', 'Pause')}"></button>
  <button class="btn btn-cam" title="${t('widget_titleWebcam', 'Show/hide webcam')}">
    <svg viewBox="0 0 24 24"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
  </button>
  <button class="btn btn-stop" title="${t('widget_titleStop', 'Stop')}">
    <svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
  </button>
</div>`;

    timerEl = shadow.querySelector('.time');
    const widget = shadow.querySelector('.widget');
    const btnToggle = shadow.querySelector('.btn-toggle');
    const btnStop = shadow.querySelector('.btn-stop');
    const btnMark = shadow.querySelector('.btn-mark');
    const btnCam = shadow.querySelector('.btn-cam');

    btnToggle.addEventListener('mousedown', e => e.stopPropagation());
    btnStop.addEventListener('mousedown', e => e.stopPropagation());
    btnMark.addEventListener('mousedown', e => e.stopPropagation());
    btnCam.addEventListener('mousedown', e => e.stopPropagation());
    btnToggle.addEventListener('click', e => { e.stopPropagation(); onToggle(); });
    btnStop.addEventListener('click', e => { e.stopPropagation(); send({ type: 'stop-and-upload' }); });
    btnMark.addEventListener('click', e => { e.stopPropagation(); onMarkScreenshot(btnMark); });
    btnCam.addEventListener('click', e => { e.stopPropagation(); toggleWebcamPreview(); });
    // Restore count if widget recreated mid-recording
    try {
      chrome.storage.local.get('manualMarkersCount', (r) => updateMarkCount(r?.manualMarkersCount || 0));
    } catch {}

    // Dragging
    widget.addEventListener('mousedown', onDragStart);

    document.body.appendChild(host);
    restorePosition();
  }

  function onToggle() {
    if (state.extensionState === 'recording') send({ type: 'pause-recording' });
    else if (state.extensionState === 'paused') send({ type: 'resume-recording' });
  }

  function onMarkScreenshot(btn) {
    if (state.extensionState !== 'recording') return;
    send({ type: 'manual-marker' });
    btn.classList.add('flash');
    btn.addEventListener('animationend', () => btn.classList.remove('flash'), { once: true });
  }

  function updateMarkCount(n) {
    if (!shadow) return;
    const badge = shadow.querySelector('.mark-count');
    if (!badge) return;
    badge.textContent = n;
    badge.classList.toggle('visible', n > 0);
  }

  function renderState() {
    if (!shadow) return;
    const dot = shadow.querySelector('.dot');
    const btnToggle = shadow.querySelector('.btn-toggle');
    const isRec = state.extensionState === 'recording';

    dot.className = isRec ? 'dot rec' : 'dot paused';

    if (isRec) {
      btnToggle.className = 'btn btn-toggle btn-pause';
      btnToggle.title = t('widget_titlePause', 'Pause');
      btnToggle.innerHTML = '<svg viewBox="0 0 24 24"><rect x="7" y="5" width="3" height="14" rx="1"/><rect x="14" y="5" width="3" height="14" rx="1"/></svg>';
      startTimer();
    } else {
      btnToggle.className = 'btn btn-toggle btn-resume';
      btnToggle.title = t('widget_titleResume', 'Resume');
      btnToggle.innerHTML = '<svg viewBox="0 0 24 24"><polygon points="8,5 19,12 8,19"/></svg>';
      stopTimer();
      showFrozenTimer();
    }
  }

  // --- Drag ---
  function onDragStart(e) {
    if (e.target.closest('.btn')) return;
    e.preventDefault();
    const rect = host.getBoundingClientRect();
    dragState = { startX: e.clientX, startY: e.clientY, origLeft: rect.left, origTop: rect.top };
    shadow.querySelector('.widget').classList.add('dragging');
    document.addEventListener('mousemove', onDragMove, true);
    document.addEventListener('mouseup', onDragEnd, true);
  }

  function onDragMove(e) {
    if (!dragState) return;
    const dx = e.clientX - dragState.startX;
    const dy = e.clientY - dragState.startY;
    host.style.left = (dragState.origLeft + dx) + 'px';
    host.style.top = (dragState.origTop + dy) + 'px';
    host.style.bottom = 'auto';
  }

  function onDragEnd() {
    if (!dragState) return;
    shadow.querySelector('.widget').classList.remove('dragging');
    const rect = host.getBoundingClientRect();
    dragState = null;
    document.removeEventListener('mousemove', onDragMove, true);
    document.removeEventListener('mouseup', onDragEnd, true);
    try {
      chrome.storage.local.set({ widgetPosition: { x: rect.left, y: rect.top } });
      // Send position as screen percentage to recorder for PiP placement
      const xPercent = Math.max(0, Math.min(1, rect.left / window.innerWidth));
      const yPercent = Math.max(0, Math.min(1, rect.top / window.innerHeight));
      chrome.runtime.sendMessage({
        type: 'webcam-position-update',
        xPercent,
        yPercent,
      }).catch(() => {});
    } catch {}
  }

  function restorePosition() {
    try {
      chrome.storage.local.get('widgetPosition', (r) => {
        if (r?.widgetPosition && host) {
          const { x, y } = r.widgetPosition;
          const maxX = window.innerWidth - 40, maxY = window.innerHeight - 40;
          if (x >= 0 && x < maxX && y >= 0 && y < maxY) {
            host.style.left = x + 'px';
            host.style.top = y + 'px';
            host.style.bottom = 'auto';
          }
        }
      });
    } catch {}
  }

  // --- State sync ---
  function applyState(s) {
    const prev = state.extensionState;
    if (s.extensionState !== undefined) state.extensionState = s.extensionState;
    if (s.recordingStartedAt !== undefined) state.recordingStartedAt = s.recordingStartedAt;
    if (s.pausedElapsed !== undefined) state.pausedElapsed = s.pausedElapsed;
    if (s.pausedAt !== undefined) state.pausedAt = s.pausedAt;

    const visible = state.extensionState === 'recording' || state.extensionState === 'paused';
    if (visible) {
      if (!host) {
        createWidget();
        startWebcamPreview(); // Start webcam preview when widget appears
      }
      renderState();
    } else {
      removeWidget();
    }
  }

  // --- Init ---
  try {
    chrome.storage.local.get(
      ['extensionState', 'recordingStartedAt', 'pausedElapsed', 'pausedAt', 'widgetPosition'],
      (r) => applyState(r || {})
    );

    chrome.storage.onChanged.addListener((changes) => {
      const patch = {};
      for (const key of ['extensionState', 'recordingStartedAt', 'pausedElapsed', 'pausedAt']) {
        if (changes[key]) patch[key] = changes[key].newValue;
      }
      if (Object.keys(patch).length) applyState(patch);
      if (changes.manualMarkersCount) updateMarkCount(changes.manualMarkersCount.newValue || 0);
    });

    // Fallback keyboard shortcut for screenshot mark (in case chrome.commands didn't register)
    // ⌘⇧S (Mac) / Ctrl+Shift+S (Win/Linux)
    document.addEventListener('keydown', (e) => {
      if (!e.shiftKey || state.extensionState !== 'recording') return;
      const isMarkS = (e.ctrlKey || e.metaKey) && e.code === 'KeyS';
      if (isMarkS) {
        e.preventDefault();
        e.stopPropagation();
        const btn = shadow?.querySelector('.btn-mark');
        if (btn) onMarkScreenshot(btn);
      }
    }, true);
  } catch { /* extension context invalidated */ }
})();
