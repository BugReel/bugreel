/**
 * BugReel — Interactive Timeline Component
 * Drag keyframe markers, click-to-seek, tooltip to add
 */

/**
 * @param {Object} options
 * @param {HTMLElement} options.container
 * @param {HTMLVideoElement} options.videoElement
 * @param {Array<{id, time_seconds, description}>} options.frames
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
    duration,
    recordingId,
    editable = true,
    onKeyframeChange,
    onKeyframeSelect,
    onKeyframeAdd,
    onKeyframeDelete,
  } = options;

  let currentFrames = [...frames];
  let activeMarkerId = null;

  // --- Build DOM ---
  container.innerHTML = '';
  container.classList.add('timeline-container');

  const track = document.createElement('div');
  track.className = 'timeline-track';

  const progress = document.createElement('div');
  progress.className = 'timeline-progress';
  track.appendChild(progress);

  // Create markers
  function createMarkerEl(frame) {
    const marker = document.createElement('div');
    marker.className = 'timeline-marker';
    if (frame.filename && recordingId) {
      marker.classList.add('has-thumb');
      marker.style.backgroundImage = `url(/api/recordings/${encodeURIComponent(recordingId)}/frames/${encodeURIComponent(frame.filename)})`;
    } else if (recordingId) {
      marker.classList.add('pending-thumb');
    }
    marker.dataset.id = frame.id;
    marker.style.left = `${(frame.time_seconds / duration) * 100}%`;
    marker.title = frame.description || `${formatTime(frame.time_seconds)}`;
    return marker;
  }

  currentFrames.forEach(f => track.appendChild(createMarkerEl(f)));

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
  container.appendChild(labels);

  // --- Video progress + auto-highlight active keyframe ---
  let autoHighlightEnabled = true;
  videoElement.addEventListener('timeupdate', () => {
    const ct = videoElement.currentTime;
    const pct = duration > 0 ? (ct / duration) * 100 : 0;
    progress.style.width = `${pct}%`;

    // Auto-highlight the keyframe whose time range covers current playback
    if (!autoHighlightEnabled || currentFrames.length === 0) return;
    const sorted = [...currentFrames].sort((a, b) => a.time_seconds - b.time_seconds);
    let activeFrame = null;
    for (let i = 0; i < sorted.length; i++) {
      const nextTime = sorted[i + 1] ? sorted[i + 1].time_seconds : duration;
      if (ct >= sorted[i].time_seconds && ct < nextTime) {
        activeFrame = sorted[i];
        break;
      }
    }
    if (activeFrame && activeFrame.id !== activeMarkerId) {
      selectMarker(activeFrame.id);
      if (onKeyframeSelect) onKeyframeSelect(activeFrame.id, activeFrame.time_seconds);
    }
  });

  // Re-enable auto-highlight when video starts playing
  videoElement.addEventListener('play', () => { autoHighlightEnabled = true; });

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

    autoHighlightEnabled = false; // disable auto-highlight on manual click
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
    track.querySelectorAll('.timeline-marker').forEach(m => {
      m.classList.toggle('active', parseInt(m.dataset.id) === frameId);
    });
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
