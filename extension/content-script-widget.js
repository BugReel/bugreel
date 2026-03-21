(() => {
  const WIDGET_ID = 'bugreel-widget';
  const WEBCAM_ID = 'bugreel-webcam';
  let controlHost = null;
  let controlShadow = null;
  let webcamHost = null;
  let webcamShadow = null;
  let webcamStream = null;
  let timerEl = null;
  let timerInterval = null;
  let state = { extensionState: 'idle', recordingStartedAt: 0, pausedElapsed: 0, pausedAt: 0 };
  let controlDragState = null;
  let webcamDragState = null;
  let collapsed = false;

  const t = (key, fallback) => {
    try { return chrome.i18n?.getMessage(key) || fallback || key; }
    catch { return fallback || key; }
  };

  function formatTime(ms) {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  function send(msg) {
    try { chrome.runtime.sendMessage(msg).catch(() => removeAll()); }
    catch { removeAll(); }
  }

  function startTimer() { stopTimer(); timerInterval = setInterval(updateTimer, 1000); updateTimer(); }
  function stopTimer() { if (timerInterval) { clearInterval(timerInterval); timerInterval = null; } }
  function updateTimer() {
    if (!timerEl) return;
    timerEl.textContent = formatTime(state.pausedElapsed + (Date.now() - state.recordingStartedAt));
  }

  // ==================== CONTROL PANEL ====================

  function createControlPanel() {
    if (controlHost) return;
    controlHost = document.createElement('div');
    controlHost.id = WIDGET_ID;
    controlHost.style.cssText = 'position:fixed;z-index:2147483647;bottom:16px;left:0;transition:transform 0.3s ease;';
    controlShadow = controlHost.attachShadow({ mode: 'closed' });

    controlShadow.innerHTML = `
<style>
  :host { all: initial; }
  .panel {
    display: flex; align-items: center; gap: 6px;
    padding: 5px 10px 5px 14px;
    background: rgba(14,21,37,0.92); border: 1px solid #1e2d48;
    border-radius: 0 10px 10px 0; /* attached to left edge */
    box-shadow: 0 4px 20px rgba(0,0,0,0.5);
    backdrop-filter: blur(12px);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    user-select: none; transition: opacity 0.2s;
  }
  .panel:hover { opacity: 1 !important; }
  .dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
  .dot.rec { background: #dc2626; animation: pulse 1.2s ease-in-out infinite; }
  .dot.paused { background: #f59e0b; animation: blink 1s step-end infinite; }
  @keyframes pulse { 0%,100%{opacity:1}50%{opacity:0.4} }
  @keyframes blink { 0%,100%{opacity:1}50%{opacity:0} }
  .time { font-size: 13px; font-weight: 600; color: #f1f5f9; font-variant-numeric: tabular-nums; font-family: ui-monospace,monospace; min-width: 30px; }
  .btn { width: 26px; height: 26px; border-radius: 50%; border: none; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: transform 0.1s; flex-shrink: 0; padding: 0; }
  .btn:hover { transform: scale(1.1); }
  .btn svg { width: 11px; height: 11px; }
  .btn-pause { background: #f59e0b; } .btn-pause svg { fill: #000; }
  .btn-resume { background: #dc2626; } .btn-resume svg { fill: #fff; }
  .btn-stop { background: #1e2d48; } .btn-stop svg { fill: #94a3b8; }
  .btn-mark { background: #1e2d48; position: relative; } .btn-mark svg { fill: #94a3b8; }
  .btn-mark.flash { background: #22c55e; } .btn-mark.flash svg { fill: #fff; }
  .btn-collapse { background: none; border: none; width: 20px; height: 26px; cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 0; }
  .btn-collapse svg { width: 10px; height: 10px; fill: #475569; transition: transform 0.3s; }
  .btn-collapse.collapsed svg { transform: rotate(180deg); }
  .mark-count { position: absolute; top: -3px; right: -3px; background: #22c55e; color: #000; font-size: 8px; font-weight: 700; min-width: 12px; height: 12px; border-radius: 6px; display: none; align-items: center; justify-content: center; padding: 0 2px; font-family: monospace; }
  .mark-count.visible { display: flex; }
</style>
<div class="panel">
  <span class="dot"></span>
  <span class="time">0:00</span>
  <button class="btn btn-mark" title="${t('widget_titleMark', 'Screenshot')} (⌘⇧S)">
    <svg viewBox="0 0 24 24"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
    <span class="mark-count"></span>
  </button>
  <button class="btn btn-toggle" title="${t('widget_titlePause', 'Pause')}"></button>
  <button class="btn btn-stop" title="${t('widget_titleStop', 'Stop')}">
    <svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
  </button>
  <button class="btn-collapse" title="Hide controls">
    <svg viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg>
  </button>
</div>`;

    timerEl = controlShadow.querySelector('.time');
    const btnToggle = controlShadow.querySelector('.btn-toggle');
    const btnStop = controlShadow.querySelector('.btn-stop');
    const btnMark = controlShadow.querySelector('.btn-mark');
    const btnCollapse = controlShadow.querySelector('.btn-collapse');

    [btnToggle, btnStop, btnMark, btnCollapse].forEach(b => b.addEventListener('mousedown', e => e.stopPropagation()));
    btnToggle.addEventListener('click', e => { e.stopPropagation(); onToggle(); });
    btnStop.addEventListener('click', e => { e.stopPropagation(); send({ type: 'stop-and-upload' }); });
    btnMark.addEventListener('click', e => { e.stopPropagation(); onMarkScreenshot(btnMark); });
    btnCollapse.addEventListener('click', e => {
      e.stopPropagation();
      collapsed = !collapsed;
      controlHost.style.transform = collapsed ? 'translateX(-85%)' : 'translateX(0)';
      btnCollapse.classList.toggle('collapsed', collapsed);
    });

    try { chrome.storage.local.get('manualMarkersCount', (r) => updateMarkCount(r?.manualMarkersCount || 0)); } catch {}
    document.body.appendChild(controlHost);
  }

  // ==================== WEBCAM CIRCLE ====================

  async function createWebcam() {
    if (webcamHost) return;
    try {
      const stored = await new Promise(r => chrome.storage.local.get(['webcamEnabled', 'webcamDeviceId', 'webcamPipSize', 'webcamCirclePosition'], r));
      if (!stored.webcamEnabled) return;

      const size = stored.webcamPipSize || 180;
      const constraints = {
        video: stored.webcamDeviceId ? { deviceId: { exact: stored.webcamDeviceId } } : true,
        audio: false,
      };
      webcamStream = await navigator.mediaDevices.getUserMedia(constraints);

      webcamHost = document.createElement('div');
      webcamHost.id = WEBCAM_ID;
      const pos = stored.webcamCirclePosition || { x: null, y: null };
      const startX = pos.x ?? (window.innerWidth - size - 24);
      const startY = pos.y ?? (window.innerHeight - size - 80);
      webcamHost.style.cssText = `position:fixed;z-index:2147483646;left:${startX}px;top:${startY}px;width:${size}px;height:${size}px;`;

      webcamShadow = webcamHost.attachShadow({ mode: 'closed' });
      webcamShadow.innerHTML = `
<style>
  :host { all: initial; }
  .cam-outer {
    position: relative; width: 100%; height: 100%;
    cursor: grab; user-select: none;
  }
  .cam-outer.dragging { cursor: grabbing; }
  .cam-circle {
    width: 100%; height: 100%; border-radius: 50%; overflow: hidden;
    border: 3px solid rgba(255,255,255,0.25);
    box-shadow: 0 4px 20px rgba(0,0,0,0.6);
  }
  .cam-outer:hover .cam-circle { border-color: rgba(255,255,255,0.5); }
  video { width: 100%; height: 100%; object-fit: cover; pointer-events: none; display: block; }
  .resize-handle {
    position: absolute; top: -4px; right: -4px;
    width: 22px; height: 22px; cursor: nwse-resize;
    display: none; align-items: center; justify-content: center;
    background: rgba(0,0,0,0.55); border-radius: 50%;
    border: 2px solid rgba(255,255,255,0.3);
    z-index: 1;
  }
  .resize-handle svg { width: 10px; height: 10px; }
  .cam-outer:hover .resize-handle { display: flex; }
</style>
<div class="cam-outer">
  <div class="cam-circle"><video autoplay playsinline muted></video></div>
  <div class="resize-handle"><svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="10,7 17,7 17,14"/></svg></div>
</div>`;

      const videoEl = webcamShadow.querySelector('video');
      videoEl.srcObject = webcamStream;

      const camWrap = webcamShadow.querySelector('.cam-outer');
      const resizeHandle = webcamShadow.querySelector('.resize-handle');

      // Drag webcam circle
      camWrap.addEventListener('mousedown', (e) => {
        if (e.target === resizeHandle) return;
        e.preventDefault();
        const rect = webcamHost.getBoundingClientRect();
        webcamDragState = { startX: e.clientX, startY: e.clientY, origLeft: rect.left, origTop: rect.top };
        camWrap.classList.add('dragging');
        document.addEventListener('mousemove', onWebcamDrag, true);
        document.addEventListener('mouseup', onWebcamDragEnd, true);
      });

      // Resize webcam circle
      resizeHandle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const startX = e.clientX;
        const startSize = webcamHost.offsetWidth;
        function onResize(ev) {
          const delta = ev.clientX - startX;
          const newSize = Math.max(80, Math.min(400, startSize + delta));
          webcamHost.style.width = newSize + 'px';
          webcamHost.style.height = newSize + 'px';
        }
        function onResizeEnd() {
          document.removeEventListener('mousemove', onResize, true);
          document.removeEventListener('mouseup', onResizeEnd, true);
          try { chrome.storage.local.set({ webcamPipSize: webcamHost.offsetWidth }); } catch {}
        }
        document.addEventListener('mousemove', onResize, true);
        document.addEventListener('mouseup', onResizeEnd, true);
      });

      document.body.appendChild(webcamHost);
    } catch (e) {
      console.warn('[BugReel] Webcam overlay failed:', e.message);
    }
  }

  function onWebcamDrag(e) {
    if (!webcamDragState) return;
    webcamHost.style.left = (webcamDragState.origLeft + e.clientX - webcamDragState.startX) + 'px';
    webcamHost.style.top = (webcamDragState.origTop + e.clientY - webcamDragState.startY) + 'px';
  }

  function onWebcamDragEnd() {
    if (!webcamDragState) return;
    webcamDragState = null;
    webcamShadow?.querySelector('.cam-outer')?.classList.remove('dragging');
    document.removeEventListener('mousemove', onWebcamDrag, true);
    document.removeEventListener('mouseup', onWebcamDragEnd, true);
    if (webcamHost) {
      const rect = webcamHost.getBoundingClientRect();
      try { chrome.storage.local.set({ webcamCirclePosition: { x: rect.left, y: rect.top } }); } catch {}
    }
  }

  function removeWebcam() {
    if (webcamStream) { webcamStream.getTracks().forEach(t => t.stop()); webcamStream = null; }
    if (webcamHost?.parentNode) webcamHost.parentNode.removeChild(webcamHost);
    webcamHost = null; webcamShadow = null;
  }

  // ==================== COMMON ====================

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
    if (!controlShadow) return;
    const badge = controlShadow.querySelector('.mark-count');
    if (!badge) return;
    badge.textContent = n;
    badge.classList.toggle('visible', n > 0);
  }

  function renderState() {
    if (!controlShadow) return;
    const dot = controlShadow.querySelector('.dot');
    const btnToggle = controlShadow.querySelector('.btn-toggle');
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
      if (timerEl) timerEl.textContent = formatTime(state.pausedElapsed);
    }
  }

  function removeAll() {
    stopTimer();
    if (controlHost?.parentNode) controlHost.parentNode.removeChild(controlHost);
    controlHost = null; controlShadow = null; timerEl = null;
    collapsed = false;
    removeWebcam();
  }

  function applyState(s) {
    if (s.extensionState !== undefined) state.extensionState = s.extensionState;
    if (s.recordingStartedAt !== undefined) state.recordingStartedAt = s.recordingStartedAt;
    if (s.pausedElapsed !== undefined) state.pausedElapsed = s.pausedElapsed;
    if (s.pausedAt !== undefined) state.pausedAt = s.pausedAt;

    const visible = state.extensionState === 'recording' || state.extensionState === 'paused';
    if (visible) {
      if (!controlHost) { createControlPanel(); createWebcam(); }
      renderState();
    } else {
      removeAll();
    }
  }

  // --- Init ---
  try {
    chrome.storage.local.get(
      ['extensionState', 'recordingStartedAt', 'pausedElapsed', 'pausedAt'],
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

    document.addEventListener('keydown', (e) => {
      if (!e.shiftKey || state.extensionState !== 'recording') return;
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS') {
        e.preventDefault(); e.stopPropagation();
        const btn = controlShadow?.querySelector('.btn-mark');
        if (btn) onMarkScreenshot(btn);
      }
    }, true);
  } catch {}
})();
