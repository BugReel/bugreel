/* recorder-segments.js — Segmented MediaRecorder with auto-restart.
 *
 * Chrome's MediaRecorder can silently stop producing video frames while
 * audio keeps flowing (issues.chromium.org/343157156). This module wraps
 * MediaRecorder in a state machine that watches for the failure and spins
 * up a new MediaRecorder on the same MediaStream so the recording
 * continues from the point of the stall.
 *
 * See docs/recording-resilience.md for the full design.
 *
 * Loaded as a classic <script> in recorder.html AND as plain source via
 * vm.runInContext from Vitest — hence the dual-export pattern at the
 * bottom and the absence of ESM syntax.
 */
(function () {
  const DEFAULTS = {
    timesliceMs: 5000,
    stallMs: 15000,
    minDataBytes: 512,
    minRestartIntervalMs: 3000,
    watchdogTickMs: 2500,
  };

  function createSegmentController(options) {
    const {
      MediaRecorderCtor = (typeof MediaRecorder !== 'undefined' ? MediaRecorder : null),
      mimeType,
      videoBitsPerSecond,
      timesliceMs = DEFAULTS.timesliceMs,
      stallMs = DEFAULTS.stallMs,
      minDataBytes = DEFAULTS.minDataBytes,
      minRestartIntervalMs = DEFAULTS.minRestartIntervalMs,
      watchdogTickMs = DEFAULTS.watchdogTickMs,
      setInterval: setIntervalFn = (typeof setInterval !== 'undefined' ? setInterval : null),
      clearInterval: clearIntervalFn = (typeof clearInterval !== 'undefined' ? clearInterval : null),
      now = () => Date.now(),
      onSegmentStart,
      onRestart,
      onFinalize,
      onData,
      log = () => {},
    } = options || {};

    if (!MediaRecorderCtor) throw new Error('MediaRecorder not available');

    const state = {
      stream: null,
      videoTrack: null,
      recorder: null,
      segments: [],        // Blob[][] — one inner array per MediaRecorder lifecycle
      stopIntent: null,    // 'finalize' | 'restart' | 'discard' | null
      lastDataTs: 0,
      lastRestartAt: 0,
      watchdog: null,
      finalized: false,
    };

    function start(stream) {
      if (state.stream) throw new Error('already started');
      state.stream = stream;
      state.videoTrack = (stream.getVideoTracks && stream.getVideoTracks()[0]) || null;
      if (state.videoTrack && typeof state.videoTrack.addEventListener === 'function') {
        // NOTE: we intentionally do NOT listen to 'mute' as a restart trigger.
        // Chromium fires mute on normal occlusions (alt-tab, window behind
        // another window, brief GPU contention), often many times per minute.
        // Restarting on each mute would fragment the recording into tiny
        // segments and naive WebM concat would show only the first segment's
        // duration in players. The watchdog (no-data-for-stallMs) already
        // catches mutes that are long enough to actually stall the encoder.
        state.videoTrack.addEventListener('mute', onTrackMuteLog);
        state.videoTrack.addEventListener('unmute', onTrackUnmuteLog);
        state.videoTrack.addEventListener('ended', onTrackEnded);
      }
      openSegment();
      startWatchdog();
    }

    function openSegment() {
      state.segments.push([]);
      state.recorder = new MediaRecorderCtor(state.stream, { mimeType, videoBitsPerSecond });
      state.recorder.ondataavailable = (e) => {
        if (!e || !e.data || e.data.size === 0) return;
        state.segments[state.segments.length - 1].push(e.data);
        if (e.data.size >= minDataBytes) state.lastDataTs = now();
        if (onData) { try { onData(e.data); } catch {} }
      };
      state.recorder.onstop = onRecorderStop;
      state.recorder.start(timesliceMs);
      state.lastDataTs = now();
      if (onSegmentStart) { try { onSegmentStart(state.segments.length); } catch {} }
    }

    function onRecorderStop() {
      const intent = state.stopIntent;
      state.stopIntent = null;
      log('recorder stopped, intent=', intent);

      if (intent === 'discard') {
        state.segments = [];
        stopWatchdog();
        return;
      }

      if (intent === 'restart') {
        if (trackIsLive()) {
          try {
            openSegment();
            if (onRestart) { try { onRestart(state.segments.length); } catch {} }
            return;
          } catch (e) {
            log('restart failed, finalizing:', e && e.message);
          }
        }
        finalize();
        return;
      }

      finalize();
    }

    function finalize() {
      if (state.finalized) return;
      state.finalized = true;
      stopWatchdog();
      if (!onFinalize) return;
      const chunks = [];
      const segmentSizes = [];
      for (const seg of state.segments) {
        if (seg.length === 0) continue;
        let segSize = 0;
        for (const c of seg) { chunks.push(c); segSize += c.size; }
        segmentSizes.push(segSize);
      }
      try {
        onFinalize({
          chunks,
          segmentCount: segmentSizes.length,
          segmentSizes,  // byte size of each non-empty segment, in order
          mimeType: (state.recorder && state.recorder.mimeType) || mimeType,
        });
      } catch (e) {
        log('onFinalize threw:', e && e.message);
      }
    }

    function onTrackMuteLog() {
      // Don't restart — the watchdog will catch it if the mute actually
      // stalls the encoder (> stallMs). Unmutes typically come back fast
      // enough that no frames are lost to player-visible truncation.
      log('track muted (not restarting; watchdog will handle genuine stalls)');
    }
    function onTrackUnmuteLog() {
      log('track unmuted');
      // Reset data watchdog — the clock on "no data" should start from
      // unmute, not from the last pre-mute frame.
      state.lastDataTs = now();
    }
    function onTrackEnded() {
      log('track ended');
      if (!state.recorder || state.recorder.state === 'inactive') { finalize(); return; }
      state.stopIntent = 'finalize';
      try { state.recorder.stop(); } catch { finalize(); }
    }

    function scheduleRestart(reason) {
      if (state.stopIntent) return;
      if (!state.recorder || state.recorder.state === 'inactive') return;
      if (!trackIsLive()) { onTrackEnded(); return; }
      const n = now();
      if (n - state.lastRestartAt < minRestartIntervalMs) {
        log('restart debounced:', reason);
        return;
      }
      state.lastRestartAt = n;
      state.stopIntent = 'restart';
      log('restart scheduled:', reason);
      try { state.recorder.stop(); }
      catch (e) { state.stopIntent = null; log('stop threw:', e && e.message); }
    }

    function startWatchdog() {
      stopWatchdog();
      if (!setIntervalFn) return;
      state.watchdog = setIntervalFn(() => {
        if (!state.recorder) return;
        if (state.recorder.state !== 'recording') return;
        if (state.stopIntent) return;
        if (now() - state.lastDataTs > stallMs) scheduleRestart('stall');
      }, watchdogTickMs);
    }

    function stopWatchdog() {
      if (state.watchdog && clearIntervalFn) clearIntervalFn(state.watchdog);
      state.watchdog = null;
    }

    function trackIsLive() {
      // `muted` is a signal the encoder won't produce frames *right now*,
      // not that the track is dead — treating muted tracks as dead would
      // turn every mute event into a finalize instead of a restart. We
      // rely on the debounce (minRestartIntervalMs) to break loops if the
      // mute persists through the new MediaRecorder too.
      return !!(state.videoTrack && state.videoTrack.readyState === 'live');
    }

    function finish() {
      if (!state.recorder || state.recorder.state === 'inactive') { finalize(); return; }
      state.stopIntent = 'finalize';
      try { state.recorder.stop(); } catch { finalize(); }
    }

    function discard() {
      stopWatchdog();
      if (state.recorder && state.recorder.state !== 'inactive') {
        state.stopIntent = 'discard';
        try { state.recorder.stop(); } catch {}
      }
      state.segments = [];
    }

    function pause() {
      stopWatchdog();
      if (state.recorder && state.recorder.state === 'recording') {
        try { state.recorder.pause(); } catch {}
      }
    }

    function resume() {
      if (state.recorder && state.recorder.state === 'paused') {
        try { state.recorder.resume(); } catch {}
      }
      state.lastDataTs = now();
      startWatchdog();
    }

    function recorderState() {
      return (state.recorder && state.recorder.state) || 'inactive';
    }

    return {
      start, finish, discard, pause, resume,
      state: recorderState,
      segmentCount: () => state.segments.filter(s => s.length > 0).length,
      // Internal hooks for tests
      _state: state,
      _tickWatchdog: () => {
        if (!state.recorder || state.recorder.state !== 'recording' || state.stopIntent) return;
        if (now() - state.lastDataTs > stallMs) scheduleRestart('stall');
      },
    };
  }

  const api = { createSegmentController, DEFAULTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof globalThis !== 'undefined') Object.assign(globalThis, api);
})();
