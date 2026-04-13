# Recording Resilience — Segmented MediaRecorder with Auto-Restart

## The problem

`MediaRecorder` + `getDisplayMedia()` on Chromium has a known failure mode
where the video encoder stops producing frames while audio continues. The
`MediaRecorder` instance keeps reporting `state === 'recording'` and never
emits an error, so a user can record for 10 minutes and end up with a file
that contains 3 minutes of video followed by 7 minutes of audio-only.

Observed in the wild: [REC-2026-0021 on skrini.ru] — 12:22 total, video
stream ends at 3:42, audio continues to the end. The user was actively
clicking and scrolling throughout.

### Confirmed Chromium bugs behind this

- [issues/343157156 — "After working for a while, MediaRecorder stops recording"](https://issues.chromium.org/issues/343157156) — Blink>MediaRecording, Mac and Windows, no fix shipped.
- [issues/40137404 — MediaStreamTrack from getDisplayMedia fires mute/unmute](https://issues.chromium.org/issues/40137404) — mute events during inactivity; some reports indicate unmute doesn't always fire back.
- [electron/electron#40440 — MediaRecorder silent crash after ~1h with VP9/VP8](https://github.com/electron/electron/issues/40440) — `onstop` called without error.

### Why timeslice alone doesn't fix it

`mediaRecorder.start(5000)` splits output into 5-second chunks via
`ondataavailable`, but all chunks come from the **same** encoder instance.
When the Chromium bug kills the encoder, every subsequent chunk from that
instance is silent-video too. Slicing the bad output into smaller pieces
doesn't produce good output.

## The design

Split the recording into independent `MediaRecorder` lifecycles. When the
encoder dies, we kill the current `MediaRecorder` and spin up a new one
on the same `MediaStream`. Segments accumulate client-side; on stop, they
are concatenated locally and uploaded as a single file through the
existing chunked-upload path.

```
capture stream (getDisplayMedia)
       │
       ▼
┌──────────────────────────┐
│ current MediaRecorder    │────► ondataavailable ──► segments[]
│  .start(timeslice=5000)  │
└──────────────────────────┘
       ▲              │
       │              ▼
  auto-restart   watchdog + onmute
       │              │
       └──── if encoder dead ────┘

on stop:
  Blob from segments[] ──► existing chunked upload ──► server
```

### Failure detection

Three independent signals, any of which triggers a restart:

1. **`videoTrack.onmute`** — Chromium fires this when screen capture
   pauses (window occluded, mute-on-inactivity, GPU hiccup). The track is
   still `live`, but we won't get useful video until it unmutes. Rather
   than gamble on unmute, we treat mute as a restart trigger.
2. **`videoTrack.onended`** — user stopped the system share (Chrome's
   "Stop sharing" button). No recovery possible; finalize with what we
   have.
3. **Data watchdog** — track wall-clock time since the last
   `ondataavailable` that contained non-trivial bytes. If > `STALL_MS`
   (15000) we assume the encoder is stuck even though no event fired.

### Restart flow

```
detectFailure()
  └─► oldRecorder.stop()                // flushes last partial chunk
       └─► on 'stop' event:
            └─► if track is still live:
                 ├─► newRecorder = new MediaRecorder(stream, opts)
                 ├─► attach ondataavailable → same segments[]
                 ├─► newRecorder.start(5000)
                 └─► toast("Захват возобновлён")      // optional
            └─► if track is dead (onended path):
                 └─► finalize()        // user sees what we have so far
```

Restart should be silent in the common case. Users notice a brief freeze
on the preview scrubber (edge of a segment), but no data is lost beyond
whatever was in flight at the moment of stall.

### Segment storage

Segments are plain `Blob` objects in an `Array<Blob>` inside the
recorder's offscreen document. Memory budget for a 3-hour 1 Mbps recording
is ~1.3 GB — at the upper bound of what Chrome allows for a single origin
but acceptable for the MVP. If we hit the RAM ceiling, we add live upload
(see "Future work").

### Finalization

On user `stop`:

1. Stop the current `MediaRecorder` (flushes trailing chunk).
2. `new Blob(segments, { type: mimeType })` — same MIME as each segment.
3. Hand the assembled blob to the existing `review.js` → `chunked-uploader.js`
   path. Everything downstream (chunked upload, server pipeline,
   compression, transcription, analysis) is unchanged.

Trimming in `review.html` still operates on the local blob before upload,
so the trim UX is unchanged.

### Concatenation correctness

Each segment is a complete WebM document with its own EBML header.
Naïvely concatenating them into a single `Blob` produces a non-conformant
file that many players still accept but `ffmpeg` rejects with "EBML
header parsing failed" past the first segment.

Two workable options:

- **Client-side:** use `MediaSource.SourceBuffer` or a tiny JS WebM muxer
  (e.g. `webm-duration-fix`) to rewrite headers into one clean stream.
- **Server-side:** upload segments as-is, have the server run `ffmpeg
  -f concat -i list.txt -c copy output.webm` to stitch them.

Server-side concat is simpler and the server already has `ffmpeg`. We'll
do it there. The client uploads a zip-like bundle of segments + a
manifest, or uploads a single concatenated blob and lets the server
demux via `matroska,webm` — test both paths during implementation.

## Implementation plan

### Phase 1 — detection + auto-restart (this change)

Files touched:
- `extension/recorder.js` — most of the logic
- `extension/popup.js` — tiny tweak if we want to surface "restart" toasts
- `server/__tests__/services/ffmpeg.test.js` — concat test (if server-side)
- Add unit tests for the watchdog + restart state machine in a new test file

Behavioral envelope:
- Users who do not hit the bug see no change at all
- Users who hit the bug now get a complete recording instead of losing
  the tail; may see a ~1s hitch at the restart point
- If the screen share is genuinely stopped (track ended), behavior is
  unchanged — we finalize with whatever was recorded

### Phase 2 — live segment upload (future, separate task)

Only when we have evidence we need it (browser crashes, >2h recordings,
RAM exhaustion reports). Design stub:

- Segments streamed to `/staging/<session>/seg-N.webm` as they are
  produced
- `stop` sends a `/finalize { trimStart, trimEnd }` which tells server
  to concat the selected range and start the pipeline
- `discard` deletes the staging dir
- Cleanup cron removes staging dirs older than 24h

This is orthogonal to Phase 1 — no need to do it until we have a real
pain point.

## Constants

```js
const TIMESLICE_MS = 5000;       // MediaRecorder.start timeslice
const STALL_MS = 15000;          // no-data watchdog threshold
const MIN_SEGMENT_BYTES = 512;   // below this, segment is "empty"
```

Tune if we see false positives on slow machines.

## Testing strategy

Hard to reproduce the Chromium bug on demand, so we rely on:

1. **Unit tests** — mock `MediaRecorder` and `MediaStreamTrack`, simulate
   `mute`, `ended`, stalled `ondataavailable`; verify restart is called.
2. **Manual long-recording** — record 30+ minutes of scrolling/clicking
   on a Retina display to stress the encoder.
3. **Synthetic "force mute"** — dev-only keybind that fires `track.mute`
   from devtools to verify recovery.
4. **Comparison with baseline** — record the same action sequence on
   `master` vs the branch and confirm durations match.
