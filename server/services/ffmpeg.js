import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';

const execAsync = promisify(exec);

/**
 * Extract audio track from video file as MP3.
 * @param {string} videoPath - path to source video
 * @param {string} audioPath - output MP3 path
 * @returns {number} duration in seconds (rounded)
 */
export async function extractAudio(videoPath, audioPath) {
  try {
    await execAsync(
      `ffmpeg -y -i "${videoPath}" -vn -acodec libmp3lame -q:a 4 "${audioPath}"`
    );
  } catch (err) {
    throw new Error(`ffmpeg extractAudio failed: ${err.stderr || err.message}`);
  }

  // Get duration — try format first, fall back to stream (Chrome WebM has no format duration)
  try {
    const { stdout } = await execAsync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`
    );
    const dur = parseFloat(stdout.trim());
    if (!isNaN(dur) && dur > 0) return Math.round(dur);
  } catch {}

  // Fallback: get duration from audio stream of the extracted MP3
  try {
    const { stdout } = await execAsync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`
    );
    const dur = parseFloat(stdout.trim());
    if (!isNaN(dur) && dur > 0) return Math.round(dur);
  } catch {}

  return 0; // unknown duration
}

/**
 * Compress video to reduce file size.
 * Re-encodes with VP9 at lower bitrate. Replaces original file.
 * @param {string} videoPath - path to WebM video
 * @returns {{ originalSize: number, compressedSize: number, ratio: number }}
 */
export async function compressVideo(videoPath) {
  const originalSize = fs.statSync(videoPath).size;
  const tmpPath = videoPath.replace('.webm', '.compressed.webm');

  try {
    // VP9 CRF 35, scale to max 1920px width (Full HD), opus audio 64k
    // -max_muxing_queue_size: fixes "Too many packets buffered" for Chrome WebM (no Duration header)
    await execAsync(
      `ffmpeg -y -i "${videoPath}" -c:v libvpx-vp9 -crf 35 -b:v 0 -cpu-used 4 -row-mt 1 -vf "scale='min(1920,iw)':-2" -c:a libopus -b:a 64k -max_muxing_queue_size 4096 "${tmpPath}"`,
      { timeout: 600000 } // 10 min max
    );

    const compressedSize = fs.statSync(tmpPath).size;

    // Only replace if actually smaller
    if (compressedSize < originalSize) {
      fs.renameSync(tmpPath, videoPath);
      return { originalSize, compressedSize, ratio: +(compressedSize / originalSize).toFixed(2) };
    } else {
      fs.unlinkSync(tmpPath);
      return { originalSize, compressedSize: originalSize, ratio: 1.0 };
    }
  } catch (err) {
    // Clean up temp file on error, keep original
    try { fs.unlinkSync(tmpPath); } catch {}
    console.error(`Video compression failed (keeping original): ${err.message}`);
    return { originalSize, compressedSize: originalSize, ratio: 1.0 };
  }
}

/**
 * Extract a single video frame at the given timestamp.
 * Scales down to max 1920px width (Full HD) to avoid huge Retina screenshots.
 * @param {string} videoPath - path to source video
 * @param {number} timeSeconds - seek position in seconds
 * @param {string} outputPath - output JPEG path
 */
export async function extractFrame(videoPath, timeSeconds, outputPath) {
  // Clamp negative timestamps to 0
  const seekTime = Math.max(timeSeconds, 0);
  const vf = `scale='min(1920,iw)':-1`;

  // Fast seek: -ss BEFORE -i jumps to the nearest prior keyframe (cheap but
  // fails on WebM recordings with sparse keyframes — ffmpeg exits 0 with an
  // empty file, which we must detect explicitly).
  try {
    await execAsync(
      `ffmpeg -y -ss ${seekTime} -i "${videoPath}" -frames:v 1 -q:v 3 -vf "${vf}" "${outputPath}"`
    );
    if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) return;
  } catch {
    // Fall through to slow seek
  }

  // Slow seek: -ss AFTER -i decodes from the start to the requested position.
  // Slower but frame-accurate — required for Chrome MediaRecorder WebM files.
  try {
    try { fs.unlinkSync(outputPath); } catch {}
    await execAsync(
      `ffmpeg -y -i "${videoPath}" -ss ${seekTime} -frames:v 1 -q:v 3 -vf "${vf}" "${outputPath}"`,
      { timeout: 120000 }
    );
  } catch (err) {
    throw new Error(`ffmpeg extractFrame failed at ${seekTime}s: ${err.stderr || err.message}`);
  }

  if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
    throw new Error(`ffmpeg extractFrame produced empty output at ${seekTime}s`);
  }
}

/**
 * Trim video to a specific time range. Re-encodes for frame-accurate seeking
 * (MediaRecorder WebM has sparse keyframes — stream copy can't seek accurately).
 * Uses same compression settings as compressVideo, so result is already compressed.
 * Replaces original file.
 * @param {string} videoPath - path to source video
 * @param {number} startSec - trim start in seconds
 * @param {number} endSec - trim end in seconds
 */
export async function trimVideo(videoPath, startSec, endSec) {
  const tmpPath = videoPath.replace('.webm', '.trimmed.webm');
  const duration = endSec - startSec;
  try {
    await execAsync(
      `ffmpeg -y -i "${videoPath}" -ss ${startSec} -t ${duration} -c:v libvpx-vp9 -crf 35 -b:v 0 -cpu-used 4 -row-mt 1 -vf "scale='min(1920,iw)':-2" -c:a libopus -b:a 64k -max_muxing_queue_size 4096 "${tmpPath}"`,
      { timeout: 300000 }
    );
    fs.renameSync(tmpPath, videoPath);
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch {}
    throw new Error(`ffmpeg trimVideo failed: ${err.stderr || err.message}`);
  }
}

/**
 * Stitch a multi-segment recording emitted by the extension's segmented
 * MediaRecorder. The client uploads the raw concatenation of N independent
 * WebM documents (each with its own EBML header) as a single file; most
 * players read the first segment's duration and ignore the rest. This
 * splits the file back by byte offsets, runs ffmpeg's concat demuxer with
 * stream-copy (no re-encode), and replaces the original with a single
 * conformant WebM.
 *
 * No-op for single-segment uploads.
 *
 * @param {string} videoPath - path to raw uploaded WebM
 * @param {number[]} segmentSizes - byte size of each segment, in order
 */
export async function concatRecorderSegments(videoPath, segmentSizes) {
  if (!Array.isArray(segmentSizes) || segmentSizes.length < 2) return;

  const totalExpected = segmentSizes.reduce((a, b) => a + b, 0);
  const actualSize = fs.statSync(videoPath).size;
  if (totalExpected !== actualSize) {
    throw new Error(
      `concatRecorderSegments: segment sizes sum to ${totalExpected} but file is ${actualSize} bytes`
    );
  }

  const dir = path.dirname(videoPath);
  const segFiles = [];
  const listPath = path.join(dir, 'recorder_concat_list.txt');
  const outPath = videoPath.replace(/\.webm$/, '.recjoined.webm');

  try {
    // Split the raw upload into per-segment files so ffmpeg sees N valid
    // WebM documents instead of one malformed one.
    const fd = fs.openSync(videoPath, 'r');
    try {
      let offset = 0;
      for (let i = 0; i < segmentSizes.length; i++) {
        const size = segmentSizes[i];
        const segPath = path.join(dir, `recseg_${i}.webm`);
        const buf = Buffer.allocUnsafe(size);
        let read = 0;
        while (read < size) {
          const n = fs.readSync(fd, buf, read, size - read, offset + read);
          if (n === 0) throw new Error(`unexpected EOF at segment ${i}`);
          read += n;
        }
        fs.writeFileSync(segPath, buf);
        segFiles.push(segPath);
        offset += size;
      }
    } finally {
      fs.closeSync(fd);
    }

    fs.writeFileSync(listPath, segFiles.map(f => `file '${f}'`).join('\n'));

    // Stream copy — all segments share codec settings (same MediaRecorder opts).
    await execAsync(
      `ffmpeg -y -f concat -safe 0 -i "${listPath}" -c copy "${outPath}"`,
      { timeout: 300000 }
    );

    fs.renameSync(outPath, videoPath);
  } catch (err) {
    try { fs.unlinkSync(outPath); } catch {}
    throw new Error(`concatRecorderSegments failed: ${err.stderr || err.message}`);
  } finally {
    for (const f of segFiles) { try { fs.unlinkSync(f); } catch {} }
    try { fs.unlinkSync(listPath); } catch {}
  }
}

/**
 * Extract multiple segments and concatenate them (stream copy, no re-encoding).
 * Used for trim + middle cuts. Replaces original file.
 * @param {string} videoPath - path to source video
 * @param {Array<{start: number, end: number}>} segments - time ranges to keep
 */
export async function segmentVideo(videoPath, segments) {
  if (segments.length === 0) return;
  if (segments.length === 1) {
    return trimVideo(videoPath, segments[0].start, segments[0].end);
  }

  const dir = path.dirname(videoPath);
  const segFiles = [];

  try {
    // Extract each segment with re-encode (MediaRecorder WebM has sparse keyframes — stream copy can't seek accurately)
    // Uses same compression settings as compressVideo, so result is already compressed
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const duration = seg.end - seg.start;
      const segPath = path.join(dir, `seg_${i}.webm`);
      await execAsync(
        `ffmpeg -y -i "${videoPath}" -ss ${seg.start} -t ${duration} -c:v libvpx-vp9 -crf 35 -b:v 0 -cpu-used 4 -row-mt 1 -vf "scale='min(1920,iw)':-2" -c:a libopus -b:a 64k -max_muxing_queue_size 4096 "${segPath}"`,
        { timeout: 300000 }
      );
      segFiles.push(segPath);
    }

    // Concat re-encoded segments (stream copy is fine here — all segments have same codec settings)
    const listPath = path.join(dir, 'concat_list.txt');
    fs.writeFileSync(listPath, segFiles.map(f => `file '${f}'`).join('\n'));

    const tmpPath = videoPath.replace('.webm', '.concat.webm');
    await execAsync(
      `ffmpeg -y -f concat -safe 0 -i "${listPath}" -c copy "${tmpPath}"`,
      { timeout: 120000 }
    );
    fs.renameSync(tmpPath, videoPath);

    // Cleanup temp files
    for (const f of segFiles) { try { fs.unlinkSync(f); } catch {} }
    try { fs.unlinkSync(listPath); } catch {}
  } catch (err) {
    // Cleanup on error
    for (const f of segFiles) { try { fs.unlinkSync(f); } catch {} }
    try { fs.unlinkSync(path.join(dir, 'concat_list.txt')); } catch {}
    try { fs.unlinkSync(videoPath.replace('.webm', '.concat.webm')); } catch {}
    throw new Error(`ffmpeg segmentVideo failed: ${err.stderr || err.message}`);
  }
}
