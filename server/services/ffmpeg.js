import { exec } from 'child_process';
import { promisify } from 'util';
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
  try {
    // -vf scale: fit within 1920px width, keep aspect ratio, only downscale (min)
    await execAsync(
      `ffmpeg -y -ss ${timeSeconds} -i "${videoPath}" -frames:v 1 -q:v 3 -vf "scale='min(1920,iw)':-1" "${outputPath}"`
    );
  } catch (err) {
    throw new Error(`ffmpeg extractFrame failed at ${timeSeconds}s: ${err.stderr || err.message}`);
  }
}
