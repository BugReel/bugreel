import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, '..', 'recorder-segments.js'), 'utf8');

function loadModule() {
  const sandbox = {
    console,
    Date,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return sandbox.createSegmentController;
}

class FakeTrack {
  constructor() {
    this.readyState = 'live';
    this.muted = false;
    this._listeners = {};
  }
  addEventListener(ev, fn) { (this._listeners[ev] ||= []).push(fn); }
  removeEventListener(ev, fn) {
    this._listeners[ev] = (this._listeners[ev] || []).filter((f) => f !== fn);
  }
  _dispatch(ev) { (this._listeners[ev] || []).forEach((fn) => fn()); }
  triggerMute() { this.muted = true; this._dispatch('mute'); }
  triggerEnded() { this.readyState = 'ended'; this._dispatch('ended'); }
}

function fakeStream(track) {
  return { getVideoTracks: () => (track ? [track] : []) };
}

// Fake MediaRecorder: synchronous onstop so the state-machine transitions
// happen deterministically within a single `await`-free test body.
function makeFakeMediaRecorder(registry) {
  return class FakeMediaRecorder {
    constructor(stream, opts = {}) {
      this.stream = stream;
      this.mimeType = opts.mimeType || 'video/webm';
      this.videoBitsPerSecond = opts.videoBitsPerSecond || 0;
      this.state = 'inactive';
      this.timeslice = null;
      this.ondataavailable = null;
      this.onstop = null;
      registry.push(this);
    }
    start(timeslice) { this.state = 'recording'; this.timeslice = timeslice; }
    pause() { this.state = 'paused'; }
    resume() { this.state = 'recording'; }
    stop() {
      if (this.state === 'inactive') return;
      this.state = 'inactive';
      if (this.onstop) this.onstop();
    }
    emit(sizeBytes = 1024) {
      if (this.ondataavailable) {
        const data = new Blob([new Uint8Array(sizeBytes)], { type: this.mimeType });
        this.ondataavailable({ data });
      }
    }
  };
}

describe('createSegmentController — segmented MediaRecorder with auto-restart', () => {
  let createSegmentController;
  let instances;
  let MediaRecorderCtor;
  let clock;
  let now;

  beforeEach(() => {
    createSegmentController = loadModule();
    instances = [];
    MediaRecorderCtor = makeFakeMediaRecorder(instances);
    clock = 10_000;
    now = () => clock;
  });

  function baseOpts(extra = {}) {
    return {
      MediaRecorderCtor,
      mimeType: 'video/webm;codecs=vp9',
      videoBitsPerSecond: 1_500_000,
      timesliceMs: 5000,
      stallMs: 15000,
      minRestartIntervalMs: 3000,
      // No-op watchdog — we trigger it explicitly via _tickWatchdog() in tests.
      setInterval: () => null,
      clearInterval: () => {},
      now,
      ...extra,
    };
  }

  it('single-segment happy path: start → data → finish → onFinalize called once with one segment', () => {
    const finalized = [];
    const ctl = createSegmentController(baseOpts({ onFinalize: (r) => finalized.push(r) }));
    const track = new FakeTrack();
    ctl.start(fakeStream(track));

    expect(instances).toHaveLength(1);
    expect(instances[0].state).toBe('recording');
    expect(instances[0].timeslice).toBe(5000);

    instances[0].emit(2048);
    instances[0].emit(2048);

    ctl.finish();

    expect(finalized).toHaveLength(1);
    expect(finalized[0].segmentCount).toBe(1);
    expect(finalized[0].chunks).toHaveLength(2);
    expect(finalized[0].mimeType).toBe('video/webm;codecs=vp9');
    expect(ctl.state()).toBe('inactive');
  });

  it('track mute does NOT restart (it fires too often; watchdog handles genuine stalls)', () => {
    const finalized = [];
    const restarts = [];
    const ctl = createSegmentController(baseOpts({
      onFinalize: (r) => finalized.push(r),
      onRestart: (idx) => restarts.push(idx),
    }));
    const track = new FakeTrack();
    ctl.start(fakeStream(track));

    instances[0].emit(2048);
    track.triggerMute();
    track.triggerMute();
    track.triggerMute();

    // Mute alone must never fragment the recording — otherwise every
    // alt-tab / window-occlusion event would split the file into a tiny
    // segment that naive WebM concat can't stitch back together.
    expect(instances).toHaveLength(1);
    expect(instances[0].state).toBe('recording');
    expect(restarts).toHaveLength(0);

    instances[0].emit(4096);
    ctl.finish();

    expect(finalized).toHaveLength(1);
    expect(finalized[0].segmentCount).toBe(1);
    expect(finalized[0].chunks).toHaveLength(2);
  });

  it('stall watchdog restarts when no data arrives for stallMs', () => {
    const ctl = createSegmentController(baseOpts());
    const track = new FakeTrack();
    ctl.start(fakeStream(track));

    instances[0].emit(2048);
    clock += 20_000; // > stallMs
    ctl._tickWatchdog();

    expect(instances).toHaveLength(2);
    expect(instances[0].state).toBe('inactive');
    expect(instances[1].state).toBe('recording');
  });

  it('back-to-back stalls are debounced by minRestartIntervalMs', () => {
    const ctl = createSegmentController(baseOpts());
    const track = new FakeTrack();
    ctl.start(fakeStream(track));

    clock += 20_000;
    ctl._tickWatchdog();          // first restart at clock ≈ 30_000
    expect(instances).toHaveLength(2);

    clock += 1_000;               // still inside 3s restart-debounce window
    ctl._tickWatchdog();
    expect(instances).toHaveLength(2); // debounced

    // For another stall to fire, we also need lastDataTs to be older than
    // stallMs — after the restart lastDataTs was reset to "now", so we
    // have to wait another stallMs for it to age out.
    clock += 20_000;
    ctl._tickWatchdog();
    expect(instances).toHaveLength(3);
  });

  it('track ended finalizes without restarting', () => {
    const finalized = [];
    const restarts = [];
    const ctl = createSegmentController(baseOpts({
      onFinalize: (r) => finalized.push(r),
      onRestart: (idx) => restarts.push(idx),
    }));
    const track = new FakeTrack();
    ctl.start(fakeStream(track));
    instances[0].emit(2048);

    track.triggerEnded();

    expect(restarts).toHaveLength(0);
    expect(finalized).toHaveLength(1);
    expect(finalized[0].segmentCount).toBe(1);
    expect(instances).toHaveLength(1);
  });

  it('discard drops all buffered data and never calls onFinalize', () => {
    const finalized = [];
    const ctl = createSegmentController(baseOpts({ onFinalize: (r) => finalized.push(r) }));
    ctl.start(fakeStream(new FakeTrack()));
    instances[0].emit(2048);

    ctl.discard();

    expect(finalized).toHaveLength(0);
    expect(ctl._state.segments).toEqual([]);
  });

  it('finish after an auto-restart concatenates chunks from both segments in order', () => {
    const finalized = [];
    const ctl = createSegmentController(baseOpts({ onFinalize: (r) => finalized.push(r) }));
    const track = new FakeTrack();
    ctl.start(fakeStream(track));

    instances[0].emit(1000);
    instances[0].emit(2000);

    clock += 20_000;
    ctl._tickWatchdog(); // stall → restart

    instances[1].emit(3000);
    instances[1].emit(4000);

    clock += 10_000;
    ctl.finish();

    expect(finalized[0].chunks.map((b) => b.size)).toEqual([1000, 2000, 3000, 4000]);
    expect(finalized[0].segmentCount).toBe(2);
  });

  it('finish while a restart is in flight still finalizes (does not leave the recording open)', () => {
    const finalized = [];
    const ctl = createSegmentController(baseOpts({ onFinalize: (r) => finalized.push(r) }));
    const track = new FakeTrack();
    ctl.start(fakeStream(track));
    instances[0].emit(2048);

    // Simulate the race: the user hits Finish while the first recorder is
    // still transitioning through a restart-triggered stop.
    clock += 20_000;
    ctl._tickWatchdog();          // restart scheduled, new recorder #2 is live
    instances[1].emit(2048);      // some data lands in segment 2
    ctl.finish();                 // user stops

    expect(finalized).toHaveLength(1);
    expect(finalized[0].segmentCount).toBe(2);
    expect(instances[1].state).toBe('inactive');
  });
});
