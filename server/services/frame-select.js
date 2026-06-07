import fs from 'fs';
import path from 'path';
import { config } from '../config.js';
import { extractCandidates } from './ffmpeg.js';
import { selectFramesVision } from './gpt.js';

// Vision-based moment selection: the model SEES dense candidate frames and picks the
// distinct meaningful screen states (+ captions) instead of guessing timestamps from
// transcript text. Single source of truth for the initial pipeline pass and the manual
// reanalyze path. Degrades gracefully to [] on any failure (caller falls back to the
// blind text-based keyFrames). Canon: docs/frame-selection-vision.md.
export async function computeVisionMoments(videoPath, framesDir, transcriptText, duration, logId = '') {
  if (!config.frameSelect.enabled || !(duration > 0)) return [];
  const tag = logId ? `[${logId}] ` : '';
  const candDir = path.join(framesDir, '_cand');
  try {
    const interval = Math.max(
      config.frameSelect.candidateInterval,
      duration / config.frameSelect.maxCandidates
    );
    const candidates = await extractCandidates(videoPath, candDir, interval, config.frameSelect.candidateWidth);
    console.log(`${tag}Vision frame-select: ${candidates.length} candidates (every ${interval.toFixed(1)}s)`);
    const moments = await selectFramesVision(candidates, transcriptText, config.frameSelect);
    console.log(`${tag}Vision selected ${moments.length} moments`);
    return moments;
  } catch (err) {
    console.error(`${tag}Vision frame-select failed, falling back: ${err.message}`);
    return [];
  } finally {
    try { fs.rmSync(candDir, { recursive: true, force: true }); } catch {}
  }
}
