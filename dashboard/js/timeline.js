/**
 * BugReel — Interactive Timeline Component
 * Drag keyframe markers, click-to-seek, tooltip to add
 */

/**
 * @param {Object} options
 * @param {HTMLElement} options.container
 * @param {HTMLVideoElement} options.videoElement
 * @param {Array<{id, time_seconds, description}>} options.frames
 * @param {Array<{time_seconds, title}>} [options.chapters]
 * @param {number} options.duration - total video duration in seconds
 * @param {boolean} [options.editable=true]
 * @param {function(frameId, newTime):void} [options.onKeyframeChange]
 * @param {function(frameId, time):void} [options.onKeyframeSelect]
 * @param {function(time):void} [options.onKeyframeAdd]
 */
export function createTimeline(options) {
  const {
    container,
    videoElement,
    frames,
    chapters = [],
    duration,
    recordingId,
    editable = true,
    onKeyframeChange,
    onKeyframeSelect,
    onKeyframeAdd,
    onKeyframeDelete,
  } = options;

  let currentFrames = [...frames];
  let currentChapters = Array.isArray(chapters) ? [...chapters] : [];
  let activeMarkerId = null;

  // --- Build DOM ---
  container.innerHTML = '';
  container.classList.add('timeline-container');

  const track = document.createElement('div');
  track.className = 'timeline-track';

  const progress = document.createElement('div');
  progress.className = 'timeline-progress';
  track.appendChild(progress);

  // --- Shared hover thumbnail preview ---
  // One floating element reused by every mark. Both frames (filename) and
  // chapters (thumb) carry a preview image served by /frames/:filename.
  const preview = document.createElement('div');
  preview.className = 'timeline-thumb-preview';
  preview.style.display = 'none';
  preview.innerHTML = '<img alt=""><span class="timeline-thumb-preview-cap"></span>';

  function thumbUrl(filename) {
    return `/api/recordings/${encodeURIComponent(recordingId)}/frames/${encodeURIComponent(filename)}`;
  }
  function showPreview(markerEl, filename, label) {
    if (!filename || !recordingId) return;
    preview.querySelector('img').src = thumbUrl(filename);
    const cap = preview.querySelector('.timeline-thumb-preview-cap');
    if (cap) cap.textContent = label || '';
    preview.style.left = markerEl.style.left;
    preview.style.display = '';
  }
  function hidePreview() { preview.style.display = 'none'; }

  // Editable frame mark — thin blue tick, draggable; preview on hover.
  function createMarkerEl(frame) {
    const marker = document.createElement('div');
    marker.className = 'timeline-marker';
    if (!frame.filename) marker.classList.add('pending');
    marker.dataset.id = frame.id;
    marker.dataset.time = frame.time_seconds;
    marker.style.left = `${(frame.time_seconds / duration) * 100}%`;
    marker.title = frame.description || `${formatTime(frame.time_seconds)}`;
    if (frame.filename) {
      marker.addEventListener('mouseenter', () => showPreview(marker, frame.filename, frame.description));
      marker.addEventListener('mouseleave', hidePreview);
    }
    return marker;
  }

  // Chapter tick — thin amber marker, read-only, click-to-seek; preview on hover.
  function createChapterEl(ch, idx) {
    const tick = document.createElement('div');
    tick.className = 'timeline-chapter-tick';
    tick.dataset.idx = idx;
    const raw = ch.time != null ? ch.time : ch.time_seconds;
    const t = Math.max(0, Math.min(duration, Number(raw) || 0));
    tick.dataset.time = t;
    tick.style.left = `${(t / duration) * 100}%`;
    tick.title = ch.title ? `${formatTime(t)} — ${ch.title}` : formatTime(t);
    tick.addEventListener('click', (e) => {
      e.stopPropagation();
      hideTooltip();
      videoElement.currentTime = t;
      setActiveByTime(t);
      if (onKeyframeSelect) onKeyframeSelect(null, t);
    });
    if (ch.thumb) {
      tick.addEventListener('mouseenter', () => showPreview(tick, ch.thumb, ch.title));
      tick.addEventListener('mouseleave', hidePreview);
    }
    return tick;
  }

  currentFrames.forEach(f => track.appendChild(createMarkerEl(f)));
  currentChapters.forEach((ch, i) => track.appendChild(createChapterEl(ch, i)));

  // --- Add-screenshot tooltip ---
  const tooltip = document.createElement('div');
  tooltip.className = 'timeline-tooltip';
  tooltip.style.display = 'none';
  tooltip.innerHTML = `
    <button class="timeline-tooltip-btn" id="timeline-add-btn">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      Screenshot
    </button>
    <span class="timeline-tooltip-time"></span>
  `;

  let tooltipTime = 0;
  let tooltipVisible = false;

  const labels = document.createElement('div');
  labels.className = 'timeline-labels';
  labels.innerHTML = `
    <span>0:00</span>
    <span>${formatTime(duration / 2)}</span>
    <span>${formatTime(duration)}</span>
  `;

  container.appendChild(track);
  container.appendChild(tooltip);
  container.appendChild(preview);
  container.appendChild(labels);

  // --- Video progress + highlight the current mark (frame or chapter) ---
  videoElement.addEventListener('timeupdate', () => {
    const ct = videoElement.currentTime;
    progress.style.width = `${duration > 0 ? (ct / duration) * 100 : 0}%`;
    setActiveByTime(ct);
  });

  // Highlight the nearest mark at or before the current time, across both
  // frames and chapters, so the timeline tracks playback uniformly.
  function setActiveByTime(ct) {
    const marks = track.querySelectorAll('.timeline-marker, .timeline-chapter-tick');
    let best = null, bestT = -Infinity;
    marks.forEach(el => {
      const tt = parseFloat(el.dataset.time);
      if (!isNaN(tt) && tt <= ct + 0.4 && tt >= bestT) { bestT = tt; best = el; }
    });
    marks.forEach(el => el.classList.toggle('active', el === best));
  }

  // --- Click on track → seek + show tooltip ---
  track.addEventListener('click', (e) => {
    if (e.target.classList.contains('timeline-marker')) return;
    const rect = track.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const time = Math.round(pct * duration * 10) / 10;
    videoElement.currentTime = time;

    // Show tooltip if editable
    if (editable && onKeyframeAdd) {
      showTooltip(pct, time);
    }
  });

  function showTooltip(pct, time) {
    tooltipTime = time;
    tooltipVisible = true;
    tooltip.style.display = '';
    tooltip.style.left = `${pct * 100}%`;
    tooltip.querySelector('.timeline-tooltip-time').textContent = formatTime(time);
  }

  function hideTooltip() {
    tooltipVisible = false;
    tooltip.style.display = 'none';
  }

  // Tooltip add button
  tooltip.querySelector('#timeline-add-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    if (onKeyframeAdd) {
      onKeyframeAdd(tooltipTime);
    }
    hideTooltip();
  });

  // Hide tooltip when clicking elsewhere
  document.addEventListener('click', (e) => {
    if (tooltipVisible && !tooltip.contains(e.target) && !track.contains(e.target)) {
      hideTooltip();
    }
  });

  // --- Marker click → select & seek ---
  track.addEventListener('click', (e) => {
    const marker = e.target.closest('.timeline-marker');
    if (!marker) return;

    hideTooltip();
    const frameId = parseInt(marker.dataset.id);
    const frame = currentFrames.find(f => f.id === frameId);
    if (!frame) return;

    selectMarker(frameId);
    videoElement.currentTime = frame.time_seconds;
    if (onKeyframeSelect) onKeyframeSelect(frameId, frame.time_seconds);
  });

  // --- Drag markers ---
  if (editable) {
    let isDragging = false;
    let dragMarkerId = null;
    let dragMarkerEl = null;

    function onDragStart(e) {
      const marker = e.target.closest('.timeline-marker');
      if (!marker) return;

      e.preventDefault();
      hideTooltip();
      isDragging = true;
      dragMarkerId = parseInt(marker.dataset.id);
      dragMarkerEl = marker;
      marker.classList.add('dragging');
      document.body.style.cursor = 'grabbing';
    }

    function onDragMove(e) {
      if (!isDragging || !dragMarkerEl) return;
      e.preventDefault();

      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const rect = track.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const time = Math.round(pct * duration * 10) / 10;

      requestAnimationFrame(() => {
        dragMarkerEl.style.left = `${pct * 100}%`;
      });

      const frame = currentFrames.find(f => f.id === dragMarkerId);
      if (frame) frame.time_seconds = time;
    }

    function onDragEnd() {
      if (!isDragging) return;
      isDragging = false;

      if (dragMarkerEl) {
        dragMarkerEl.classList.remove('dragging');
        selectMarker(dragMarkerId);
      }

      document.body.style.cursor = '';

      const frame = currentFrames.find(f => f.id === dragMarkerId);
      if (frame && onKeyframeChange) {
        onKeyframeChange(dragMarkerId, frame.time_seconds);
      }

      dragMarkerId = null;
      dragMarkerEl = null;
    }

    track.addEventListener('mousedown', onDragStart);
    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', onDragEnd);

    track.addEventListener('touchstart', (e) => {
      const touch = e.touches[0];
      const el = document.elementFromPoint(touch.clientX, touch.clientY);
      if (el && el.classList.contains('timeline-marker')) {
        onDragStart({ target: el, preventDefault: () => e.preventDefault() });
      }
    }, { passive: false });
    document.addEventListener('touchmove', onDragMove, { passive: false });
    document.addEventListener('touchend', onDragEnd);
  }

  // --- Select / highlight a marker ---
  function selectMarker(frameId) {
    activeMarkerId = frameId;
    track.querySelectorAll('.timeline-marker, .timeline-chapter-tick').forEach(m => m.classList.remove('active'));
    const el = track.querySelector(`.timeline-marker[data-id="${frameId}"]`);
    if (el) el.classList.add('active');
  }

  const resizeObserver = new ResizeObserver(() => {});
  resizeObserver.observe(track);

  // --- Public API ---
  return {
    addMarker(frame) {
      currentFrames.push(frame);
      track.appendChild(createMarkerEl(frame));
    },
    removeMarker(frameId) {
      currentFrames = currentFrames.filter(f => f.id !== frameId);
      const el = track.querySelector(`.timeline-marker[data-id="${frameId}"]`);
      if (el) el.remove();
      if (activeMarkerId === frameId) {
        activeMarkerId = null;
      }
    },
    setFrames(newFrames) {
      currentFrames = [...newFrames];
      track.querySelectorAll('.timeline-marker').forEach(m => m.remove());
      currentFrames.forEach(f => track.appendChild(createMarkerEl(f)));
    },
    getFrames() { return [...currentFrames]; },
    select(frameId) {
      const frame = currentFrames.find(f => f.id === frameId);
      if (frame) { selectMarker(frameId); }
    },
    destroy() { resizeObserver.disconnect(); container.innerHTML = ''; },
  };
}

function formatTime(seconds) {
  if (seconds == null) return '0:00';
  const s = Math.round(seconds);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}
