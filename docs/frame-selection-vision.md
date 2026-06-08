# Vision-based key-frame selection

> **What & why.** Key frames and chapter thumbnails used to be chosen from **blind
> timestamps** — GPT picked times by reading the transcript text only, never seeing the
> screen. On screen recordings (demos, lessons) that lands thumbnails on transitions,
> loading spinners, and blank frames, and spaces chapters at round intervals (0/30/60s).
> This replaces that with **vision selection**: the model SEES dense candidate frames and
> picks the genuinely distinct, meaningful screen states (+ captions).
>
> Ported from the BigBen tracker (same engine lineage); validated live on Skrini recordings.

## How it works

1. `ffmpeg.extractCandidates(video, dir, intervalSec, width)` — one ffmpeg pass (`fps`
   filter) dumps a downscaled candidate every `intervalSec`. Scales to any length;
   `intervalSec` auto-stretches once candidates would exceed `maxCandidates`.
2. `gpt.selectFramesVision(candidates, transcript, opts)` — sends candidates (each labelled
   `[frame t=Xs] speech: «…»`, `detail: high`) to a vision model in windows of `windowSize`.
   Returns `[{time, description, detail}]` — distinct moments only, blanks/dupes dropped.
   Captions are written in the on-screen / narration language.

   ⭐ **Narration-led (parity with BigBen tracker, 2026-06-08).** The selection and the caption
   are led by the **SPEECH**, not the picture. `transcript` is the full `{text, words}` object;
   for each candidate `speechAround()` attaches the words spoken in `[t-speechBefore, t+speechAfter]`
   (default −5/+6 s) right next to that frame's image. The prompt ties each caption to *what the
   user says about that screen* (and, when they report a problem, what is wrong) — not a standalone
   description of the picture. `title` = the point of the moment in the user's words; `detail` =
   the meaning of what they say, grounded in on-screen specifics (names, IDs, statuses).
   General-purpose by design: works for lessons/demos as "what happens at this step", and for bug
   reports it naturally surfaces the concrete thing to fix — so it stays correct for chapter
   thumbnails too. Passing a plain string still works (legacy fallback).
3. `pipeline.js` runs this once per recording, then:
   - **bug/feature/enhancement:** vision moments become the card key frames (falls back
     to the old text `keyFrames` if vision fails).
   - **all types (lessons/meetings/demos):** each chapter **thumbnail** snaps to the
     nearest vision moment within `chapterSnapWindow` (the chapter's `time` — the
     navigation seek point — is left unchanged; only the preview frame moves to a
     meaningful nearby state).

## Config (`config.frameSelect`, all env-overridable)

| Key | Default | Meaning |
|---|---|---|
| `enabled` | `1` | master switch (`FRAME_SELECT_ENABLED=0` to disable) |
| `model` | `gpt-5-mini` | vision model (needs a vision-capable endpoint; gptproxy.ru OK) |
| `reasoning` | `minimal` | `reasoning_effort` for GPT-5/o-models |
| `candidateInterval` | `4` | seconds between candidates |
| `maxCandidates` | `600` | safety: interval stretches past this (very long video) |
| `windowSize` | `50` | candidates per vision call |
| `candidateWidth` | `1280` | px — readability of small UI text |
| `chapterSnapWindow` | `20` | sec — snap a chapter thumb to a vision moment within this range |
| `speechBefore` | `5` | sec of narration before a frame attached as its speech window |
| `speechAfter` | `6` | sec of narration after a frame attached as its speech window |

`maxScreenshots` is now `0` = no fixed limit (the model decides count; a long video has
more distinct moments). A positive value, or `maxScreenshotsCeiling` (default 200), is a
runaway safety ceiling only — not a working cap.

## Cost

~16k tokens per ~3-min recording (one window) on gpt-5-mini ≈ a fraction of a cent.
Windowed, so a 20-min video is a few calls. Gated by `frameSelect.enabled`.

## Shared helper

`services/frame-select.js` (`computeVisionMoments`) is the single source of truth for the
extract-candidates → vision-select pass. Both the initial pipeline run (`pipeline.js`) and
the manual reanalyze path (`routes/cards.js`) call it, so they can never drift. It returns
`[]` on any failure and the caller falls back to the blind text `keyFrames`.

## Export render — checklist with visible captions

`export-youtrack` used to emit frames as `![description](url)` — the `description` went only
into alt-text (invisible) and `detail` was dropped, so a card was a silent wall of
screenshots. Now it builds a **checklist**: each frame is a `- [ ]` item with a visible
title (`timecode — point of the moment`) over the screenshot and the `detail` caption in
italics under it. One item = one moment. The reanalyze path also persists `detail` now (the
column existed but the INSERT skipped it). This mirrors the BigBen tracker so a reviewer reads
the whole story off the captions without reopening the recording.
