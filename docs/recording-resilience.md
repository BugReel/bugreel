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

Two independent signals trigger a restart; a third is observed for
diagnostic logging only.

1. **`videoTrack.onended`** — user stopped the system share (Chrome's
   "Stop sharing" button). No recovery possible; finalize with what we
   have.
2. **Data watchdog** — track wall-clock time since the last
   `ondataavailable` that contained non-trivial bytes. If > `STALL_MS`
   (15000) we assume the encoder is stuck even though no event fired.
3. **`videoTrack.onmute` / `onunmute`** — *logged but not actioned.*
   Originally we treated mute as a restart trigger (first draft of this
   doc). That turned out to fragment every recording where the user
   alt-tabs or the window gets occluded, because Chrome fires mute/unmute
   many times per session. Each restart produces a fresh WebM EBML
   header, and a naive concat produces a Blob where the player reads the
   first segment's duration and ignores the rest — we saw 6-second
   "recordings" out of 6-minute captures. The watchdog catches the only
   scenario we actually care about (mute that persists long enough to
   stall the encoder), so onmute is no longer a trigger. The unmute
   handler resets `lastDataTs` so the watchdog's clock starts fresh from
   the moment frames can flow again.

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

### Phase 1.5 — staged preview for multi-segment recordings

**Problem after Phase 1:** when a restart fires, the local Blob handed to
review.html is N independent WebM documents back-to-back. Browsers read
the first document's EBML header and stop at its duration, so the trim
UI shows a 6-second clip of a 6-minute recording. The data is all there
and server-side concat does stitch it correctly, but the user never sees
the full recording before upload.

**Approach:** skip local preview for multi-segment recordings. Stage the
raw bytes on the server, let the existing `concatRecorderSegments`
produce a valid single-document WebM, download that back into IDB, and
open review.html on the clean file. From review.html's perspective
nothing changes — it plays a normal single-segment blob.

**Trade-off accepted:** one extra round-trip (segments up, stitched blob
down) in the ~1% of recordings that actually hit the Chromium encoder
bug. No client-side WebM muxer to maintain. 99% of recordings are
unaffected.

```
Stop pressed
  │
  ▼
segmentCount === 1? ── yes ──► existing flow (open review.html on local blob)
  │ no
  ▼
show "Обрабатываем запись…" in the recorder window
  │
  ▼
POST /api/upload?stage_only=1     (or /api/upload/init + chunks + complete?stage_only=1)
  │  multipart: video + recorder_segment_sizes
  ▼
server: concatRecorderSegments on disk, create recordings row with
        status='staged', DO NOT enqueuePipeline yet.
        Respond: { recording_id, video_url }
  │
  ▼
GET video_url  (fetch as Blob)
  │
  ▼
save Blob + { stagedRecordingId } to IDB, open review.html
  │
  ▼
user trims, hits Upload
  │
  ▼
if stagedRecordingId present:
    POST /api/recordings/:id/finalize { trim_start, trim_end, segments }
    — server applies trim to the already-stored file, enqueues pipeline
else:
    regular upload (unchanged)
```

**Server changes:**
- `POST /api/upload` accepts `stage_only=1` (query or body). When set:
  create the recording with `status='staged'`, run `concatRecorderSegments`
  as usual, but do **not** `enqueuePipeline`. Respond with
  `{ id, video_url }` where `video_url` is a route the extension can
  GET to fetch the stitched WebM.
- `POST /api/upload/:id/complete` accepts the same flag (propagated
  from init's metadata).
- New `GET /api/recordings/:id/raw` — streams `video.webm` from the
  recording's data directory. Authenticated via extension token
  (same as upload). Only works while `status='staged'` (short window)
  or via admin — prevents using it as a public download after pipeline
  finishes.
- New `POST /api/recordings/:id/finalize` — accepts
  `{ trim_start, trim_end, segments, url_events, ... }`, updates the
  recording row, flips `status` from `staged` to `uploaded`, enqueues
  pipeline. Pipeline behaviour is unchanged (trim is applied during
  processing as usual).

**DB:** add `'staged'` to the allowed `status` values (or just use an
untyped string column if already loose). No new columns needed — trim
fields already exist.

**Client changes:**
- New UI state `processing-multisegment` in the recorder window:
  "Восстанавливаем запись после сбоя…" with an indeterminate spinner.
- In `handleRecordingFinished`, branch on `recordedSegmentCount > 1`:
  1. Upload raw blob via the same `directUpload` / `doUpload` path but
     with `stage_only=1` and without auto-open review.
  2. Parse response, `fetch(video_url)` → Blob.
  3. `saveRecordingBlob(blob, { ..., stagedRecordingId })`.
  4. Proceed to the existing review flow.
- In the upload-from-review path (`doUpload`), check for
  `data.stagedRecordingId`. If present, call the finalize endpoint
  instead of the full upload. Blob is **not** re-uploaded.
- Cleanup: if the user hits Discard on a staged recording, call
  `DELETE /api/recordings/:id` (already exists) to remove the staged
  file on the server.

**Cost envelope:**
- 1 round-trip extra in multi-segment case (rare).
- Staged recordings linger on the server until the user hits
  Upload/Discard or a TTL cleanup runs. Reuse upload-sessions cleanup
  (24h) or similar.

**What does NOT change:**
- review.html trim/UI behaviour.
- Pipeline (still runs once, after finalize, on the stitched file).
- Share URLs.
- Single-segment recordings — flow is identical to pre-Phase-1.5.

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

## Observability & decision criteria

We don't actually know how common the Chromium encoder stall is in the
wild. The first in-the-wild hit (REC-2026-0021) happened on a machine with
~100 MB of free disk space, so it's plausible that disk pressure — not the
Chromium bug — caused that particular stall. Both causes produce the same
symptom (encoder stops producing frames), and the watchdog catches both,
but we added Phase 1.5 (staged preview round-trip) specifically for the
multi-segment UX, and that path is the one we want to justify with data.

### What we record

Column `recordings.recorder_segment_count` (INTEGER, nullable):
- `NULL` — pre-fix client, or upload that didn't declare the field.
- `1` — normal recording, no restart happened. 99% expected.
- `>1` — watchdog restarted the encoder N-1 times during capture.

Set by both `routes/upload.js` and `services/chunked-upload.js` when the
client sends `recorder_segment_sizes` (multipart body) or
`recorderSegmentSizes` (chunked metadata), with a fallback to the
`X-Recording-Segments` header.

Logs also emit `[upload ${id}] concat N recorder segments, sizes=[...]`
and `[chunked-upload ${id}] concat N recorder segments, sizes=[...]`, so
the same data is grep-able if the DB is ever lost.

### Queries to run

```sql
-- How many recordings per segment-count bucket in the last 30 days?
SELECT recorder_segment_count, COUNT(*) AS n
FROM recordings
WHERE created_at > datetime('now', '-30 days')
GROUP BY recorder_segment_count
ORDER BY recorder_segment_count NULLS FIRST;

-- Rate of multi-segment recordings (the ones Phase 1.5 actually helps):
SELECT
  SUM(CASE WHEN recorder_segment_count > 1 THEN 1 ELSE 0 END) * 1.0 /
  NULLIF(SUM(CASE WHEN recorder_segment_count >= 1 THEN 1 ELSE 0 END), 0)
  AS multi_segment_rate
FROM recordings
WHERE created_at > datetime('now', '-30 days');

-- Correlate with duration — long recordings are where the Chromium bug
-- is most likely to bite. If multi-segment shows up only on <5 min
-- recordings, disk/OOM is a more likely cause than the encoder bug.
SELECT
  CASE
    WHEN duration_seconds < 300 THEN '0-5 min'
    WHEN duration_seconds < 900 THEN '5-15 min'
    WHEN duration_seconds < 1800 THEN '15-30 min'
    ELSE '30+ min'
  END AS bucket,
  COUNT(*) AS total,
  SUM(CASE WHEN recorder_segment_count > 1 THEN 1 ELSE 0 END) AS multi_seg
FROM recordings
WHERE created_at > datetime('now', '-30 days') AND duration_seconds IS NOT NULL
GROUP BY bucket
ORDER BY MIN(duration_seconds);
```

### Decision tree — 2 weeks after deploy (target review date: 2026-04-28)

Collect stats from the queries above, then:

| Signal | Action |
|---|---|
| 0 recordings with `recorder_segment_count > 1` | Rip out Phase 1.5 entirely. Keep Phase 1 (watchdog + server concat) as defensive insurance — it's small and battle-tested. |
| 1-5 recordings, all short | Likely disk/OOM, not the Chromium bug. Rip out Phase 1.5, keep Phase 1. Add a "low disk space" check at recording start as a nicer UX. |
| >5 recordings spanning multiple durations | Phase 1.5 justified. Keep everything. Consider adding a toast on the review page ("запись была восстановлена после сбоя") so user knows something happened. |
| Multi-segment concentrated in 30+ min recordings | Classic Chromium encoder stall pattern. Keep Phase 1.5. Consider Phase 2 (live segment upload) to cap RAM usage for very long recordings. |

### What to rip out if the answer is "unnecessary"

If Phase 1.5 goes away, these are the things to delete:
- `stageMultiSegmentRecording` + `stageUpload` in `extension/recorder.js`
- The `stagedRecordingId`/`stagedShareToken` handling in `handleRecordingFinished`, `doUpload`, `doDiscard`
- The `stage_only` branches in `server/routes/upload.js` and `server/services/chunked-upload.js`
- `POST /api/recordings/:id/finalize` route in `server/routes/recordings.js`
- The `status='staged'` value (migration: flip any stragglers to `'uploaded'`)
- Cloud: `app.post('/api/recordings/:id/finalize', ...)` handler in `skrini.ru/cloud/server.js`

Phase 1 (watchdog + server concat) stays in either case — it adds bytes
of correctness to a real WebM that would otherwise be malformed.

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
