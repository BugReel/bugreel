// Split a transcript (with word-level timestamps) into overlapping time-bounded
// chunks so each can be sent to GPT independently. Used by the map-reduce
// pipeline path for long recordings where the model can't reliably attend to
// the whole transcript at once.
//
// All output timestamps are ABSOLUTE (same scale as the input words.start).

export const DEFAULT_CHUNK_TARGET_SEC = 480; // 8 minutes
export const DEFAULT_CHUNK_OVERLAP_SEC = 30;
export const CHUNKING_THRESHOLD_SEC = 900;   // 15 minutes — below this, single-pass is fine

function filterEvents(events, startSec, endSec) {
  if (!Array.isArray(events) || events.length === 0) return null;
  const filtered = events.filter(e => {
    const ts = Number(e.ts ?? e.time ?? 0);
    return ts >= startSec && ts < endSec;
  });
  return filtered.length ? filtered : null;
}

/**
 * Split a transcript into overlapping chunks.
 *
 * @param {{text: string, words?: Array<{word: string, start: number, end?: number}>}} transcript
 * @param {number} durationSec
 * @param {Object} [opts]
 * @param {number} [opts.targetSec=480]    Target chunk size (sliding window length).
 * @param {number} [opts.overlapSec=30]    Overlap between consecutive chunks.
 * @param {Array}  [opts.urlEvents]
 * @param {Array}  [opts.consoleEvents]
 * @param {Array}  [opts.actionEvents]
 * @returns {Array<{startSec: number, endSec: number, text: string, words: Array, urlEvents: Array|null, consoleEvents: Array|null, actionEvents: Array|null}>}
 */
export function splitTranscriptIntoChunks(transcript, durationSec, opts = {}) {
  const targetSec  = opts.targetSec  ?? DEFAULT_CHUNK_TARGET_SEC;
  const overlapSec = opts.overlapSec ?? DEFAULT_CHUNK_OVERLAP_SEC;

  const words = Array.isArray(transcript?.words) ? transcript.words : [];
  const stride = Math.max(1, targetSec - overlapSec);

  // Degenerate inputs — return a single chunk covering everything we have.
  if (!durationSec || durationSec <= targetSec || words.length === 0) {
    return [{
      startSec: 0,
      endSec: durationSec || 0,
      text: transcript?.text || '',
      words,
      urlEvents:     filterEvents(opts.urlEvents,     0, durationSec || Infinity),
      consoleEvents: filterEvents(opts.consoleEvents, 0, durationSec || Infinity),
      actionEvents: filterEvents(opts.actionEvents,   0, durationSec || Infinity),
    }];
  }

  const chunks = [];
  let chunkStart = 0;
  while (chunkStart < durationSec) {
    let chunkEnd = Math.min(chunkStart + targetSec, durationSec);

    // Try to snap the end forward (up to +30s) to the next sentence boundary,
    // so we don't cut mid-utterance. Cap so chunks don't get insanely long.
    if (chunkEnd < durationSec) {
      const snapWindowEnd = Math.min(chunkEnd + 30, durationSec);
      for (const w of words) {
        if (w.start < chunkEnd) continue;
        if (w.start >= snapWindowEnd) break;
        if (/[.!?]$/.test((w.word || '').trim())) {
          chunkEnd = w.start + 0.5;
          break;
        }
      }
    }

    const chunkWords = words.filter(w => w.start >= chunkStart && w.start < chunkEnd);
    if (chunkWords.length === 0) {
      // Empty chunk shouldn't happen for real transcripts but guard against
      // pathological inputs (e.g. all words clustered in one chunk).
      chunkStart += stride;
      continue;
    }

    chunks.push({
      startSec: chunkStart,
      endSec: chunkEnd,
      text: chunkWords.map(w => w.word).join(' ').trim(),
      words: chunkWords,
      urlEvents:     filterEvents(opts.urlEvents,     chunkStart, chunkEnd),
      consoleEvents: filterEvents(opts.consoleEvents, chunkStart, chunkEnd),
      actionEvents: filterEvents(opts.actionEvents,   chunkStart, chunkEnd),
    });

    if (chunkEnd >= durationSec) break;
    chunkStart += stride;
  }

  return chunks;
}

/**
 * Merge same-time-bucket items from multiple chunks into a single deduplicated
 * array. Two items collapse if their timestamps are within `windowSec`.
 *
 * Used to flatten per-chunk extractActionItems / extractKeyConcepts results.
 */
export function dedupeByTime(items, windowSec = 30, getTime = it => it.time) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const sorted = [...items].sort((a, b) => (getTime(a) ?? 0) - (getTime(b) ?? 0));
  const out = [];
  for (const it of sorted) {
    const t = Number(getTime(it)) || 0;
    const last = out[out.length - 1];
    if (last && Math.abs((Number(getTime(last)) || 0) - t) <= windowSec) {
      // Prefer the longer / more detailed entry.
      const lastLen = JSON.stringify(last).length;
      const itLen   = JSON.stringify(it).length;
      if (itLen > lastLen) out[out.length - 1] = it;
      continue;
    }
    out.push(it);
  }
  return out;
}
