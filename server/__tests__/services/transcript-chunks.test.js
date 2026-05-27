import { describe, it, expect } from 'vitest';
import {
  splitTranscriptIntoChunks,
  dedupeByTime,
  DEFAULT_CHUNK_TARGET_SEC,
  DEFAULT_CHUNK_OVERLAP_SEC,
} from '../../services/transcript-chunks.js';

// Build a synthetic transcript with one word per second, alternating punctuation
// every Nth word so we can test sentence-boundary snapping.
function makeTranscript(durationSec, { sentenceEvery = 5 } = {}) {
  const words = [];
  for (let i = 0; i < durationSec; i++) {
    const isEnd = (i + 1) % sentenceEvery === 0;
    words.push({
      word: `w${i}${isEnd ? '.' : ''}`,
      start: i,
      end: i + 1,
    });
  }
  return {
    text: words.map(w => w.word).join(' '),
    words,
  };
}

describe('splitTranscriptIntoChunks — degenerate inputs', () => {
  it('returns a single chunk when duration is below target', () => {
    const tr = makeTranscript(120);
    const chunks = splitTranscriptIntoChunks(tr, 120);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].startSec).toBe(0);
    expect(chunks[0].endSec).toBe(120);
    expect(chunks[0].words).toHaveLength(120);
  });

  it('returns a single chunk when duration equals target', () => {
    const tr = makeTranscript(DEFAULT_CHUNK_TARGET_SEC);
    const chunks = splitTranscriptIntoChunks(tr, DEFAULT_CHUNK_TARGET_SEC);
    expect(chunks).toHaveLength(1);
  });

  it('returns a single chunk when no words are present', () => {
    const chunks = splitTranscriptIntoChunks({ text: 'short', words: [] }, 5000);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe('short');
    expect(chunks[0].words).toEqual([]);
  });

  it('handles missing/zero duration gracefully', () => {
    const chunks = splitTranscriptIntoChunks({ text: '', words: [] }, 0);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].endSec).toBe(0);
  });
});

describe('splitTranscriptIntoChunks — multi-chunk splitting', () => {
  it('splits a long transcript into overlapping chunks with proper stride', () => {
    // 20 minutes = 1200s, target 480s, overlap 30s → stride 450s.
    // Expected starts: 0, 450, 900; ends snap near 480, 930, 1200.
    const tr = makeTranscript(1200, { sentenceEvery: 5 });
    const chunks = splitTranscriptIntoChunks(tr, 1200);
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    expect(chunks[0].startSec).toBe(0);
    expect(chunks[1].startSec).toBe(450);
    expect(chunks[2].startSec).toBe(900);
    // Last chunk must reach the end.
    expect(chunks[chunks.length - 1].endSec).toBe(1200);
  });

  it('chunks have overlap of at least overlapSec', () => {
    const tr = makeTranscript(2000, { sentenceEvery: 10 });
    const chunks = splitTranscriptIntoChunks(tr, 2000);
    for (let i = 1; i < chunks.length; i++) {
      const overlap = chunks[i - 1].endSec - chunks[i].startSec;
      expect(overlap).toBeGreaterThanOrEqual(DEFAULT_CHUNK_OVERLAP_SEC);
    }
  });

  it('respects custom target/overlap options', () => {
    const tr = makeTranscript(600, { sentenceEvery: 5 });
    const chunks = splitTranscriptIntoChunks(tr, 600, { targetSec: 200, overlapSec: 20 });
    // stride = 180; starts: 0, 180, 360, 540
    expect(chunks[0].startSec).toBe(0);
    expect(chunks[1].startSec).toBe(180);
    expect(chunks[chunks.length - 1].endSec).toBe(600);
  });
});

describe('splitTranscriptIntoChunks — sentence boundary snapping', () => {
  it('snaps chunk end forward to the next sentence boundary within 30s', () => {
    // Custom transcript: target 100s, with a sentence ending exactly at word
    // index 110 (so word.start = 110 with trailing period).
    const words = [];
    for (let i = 0; i < 300; i++) {
      words.push({ word: i === 110 ? 'end.' : `w${i}`, start: i, end: i + 1 });
    }
    const tr = { text: words.map(w => w.word).join(' '), words };
    const chunks = splitTranscriptIntoChunks(tr, 300, { targetSec: 100, overlapSec: 10 });
    // First chunk should snap from 100 → ~110.5 (sentence boundary).
    expect(chunks[0].endSec).toBeCloseTo(110.5, 1);
  });

  it('does not snap past 30s window beyond target', () => {
    const words = [];
    for (let i = 0; i < 300; i++) {
      // Sentence end at i=150 — well outside the 30s snap window from target=100.
      words.push({ word: i === 150 ? 'far.' : `w${i}`, start: i, end: i + 1 });
    }
    const tr = { text: words.map(w => w.word).join(' '), words };
    const chunks = splitTranscriptIntoChunks(tr, 300, { targetSec: 100, overlapSec: 10 });
    // No boundary in [100, 130) → end stays at target.
    expect(chunks[0].endSec).toBe(100);
  });
});

describe('splitTranscriptIntoChunks — event filtering', () => {
  it('filters urlEvents/consoleEvents/actionEvents by chunk time range', () => {
    const tr = makeTranscript(1200, { sentenceEvery: 5 });
    const urlEvents = [
      { ts: 10, url: 'a' },
      { ts: 500, url: 'b' },
      { ts: 1100, url: 'c' },
    ];
    const consoleEvents = [
      { time: 5, msg: 'x' },
      { time: 950, msg: 'y' },
    ];
    const chunks = splitTranscriptIntoChunks(tr, 1200, { urlEvents, consoleEvents });

    // First chunk [0, ~480]: only ts=10 url, time=5 console.
    expect(chunks[0].urlEvents).toEqual([{ ts: 10, url: 'a' }]);
    expect(chunks[0].consoleEvents).toEqual([{ time: 5, msg: 'x' }]);
    // Second chunk [450, ~930]: only ts=500 url, no console.
    expect(chunks[1].urlEvents).toEqual([{ ts: 500, url: 'b' }]);
    expect(chunks[1].consoleEvents).toBeNull();
    // Last chunk should include ts=1100 url and time=950 console.
    const last = chunks[chunks.length - 1];
    expect(last.urlEvents).toEqual([{ ts: 1100, url: 'c' }]);
    expect(last.consoleEvents).toEqual([{ time: 950, msg: 'y' }]);
  });

  it('returns null for events arrays that are empty/missing', () => {
    const tr = makeTranscript(1200, { sentenceEvery: 5 });
    const chunks = splitTranscriptIntoChunks(tr, 1200);
    for (const c of chunks) {
      expect(c.urlEvents).toBeNull();
      expect(c.consoleEvents).toBeNull();
      expect(c.actionEvents).toBeNull();
    }
  });
});

describe('splitTranscriptIntoChunks — last chunk handling', () => {
  it('last chunk endSec equals durationSec exactly', () => {
    const tr = makeTranscript(1500, { sentenceEvery: 5 });
    const chunks = splitTranscriptIntoChunks(tr, 1500);
    expect(chunks[chunks.length - 1].endSec).toBe(1500);
  });

  it('does not produce a tiny tail chunk past durationSec', () => {
    const tr = makeTranscript(1500, { sentenceEvery: 5 });
    const chunks = splitTranscriptIntoChunks(tr, 1500);
    for (const c of chunks) {
      expect(c.endSec).toBeLessThanOrEqual(1500);
      expect(c.startSec).toBeLessThan(1500);
    }
  });
});

describe('dedupeByTime', () => {
  it('returns empty array for empty input', () => {
    expect(dedupeByTime([])).toEqual([]);
    expect(dedupeByTime(null)).toEqual([]);
  });

  it('keeps items spaced further than windowSec apart', () => {
    const items = [
      { time: 10, text: 'a' },
      { time: 60, text: 'b' },
      { time: 200, text: 'c' },
    ];
    const out = dedupeByTime(items, 30);
    expect(out).toHaveLength(3);
  });

  it('collapses items within windowSec, keeping the longer entry', () => {
    const items = [
      { time: 10, text: 'short' },
      { time: 20, text: 'this is a much longer and more detailed entry' },
      { time: 500, text: 'far away' },
    ];
    const out = dedupeByTime(items, 30);
    expect(out).toHaveLength(2);
    expect(out[0].text).toContain('longer');
    expect(out[1].text).toBe('far away');
  });

  it('keeps original entry when later item is shorter', () => {
    const items = [
      { time: 10, text: 'a long detailed action item describing the work' },
      { time: 25, text: 'short' },
    ];
    const out = dedupeByTime(items, 30);
    expect(out).toHaveLength(1);
    expect(out[0].text).toContain('long detailed');
  });

  it('sorts input by time before deduping', () => {
    const items = [
      { time: 500, text: 'late' },
      { time: 10, text: 'early' },
      { time: 100, text: 'middle' },
    ];
    const out = dedupeByTime(items, 30);
    expect(out.map(i => i.time)).toEqual([10, 100, 500]);
  });

  it('supports custom getTime accessor', () => {
    const items = [
      { ts: 10, text: 'a' },
      { ts: 20, text: 'b longer' },
    ];
    const out = dedupeByTime(items, 30, it => it.ts);
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe('b longer');
  });
});
