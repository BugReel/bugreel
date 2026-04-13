import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Mock child_process.exec before importing ffmpeg.js, since execAsync is
// created at module load time from promisify(exec).
const execMock = vi.fn();
vi.mock('child_process', () => ({ exec: (...args) => execMock(...args) }));

const { extractFrame, concatRecorderSegments } = await import('../../services/ffmpeg.js');

// Helper: have execMock behave like child_process.exec, invoking the node-style
// callback asynchronously with the supplied result.
function stubExec(behavior) {
  execMock.mockImplementation((cmd, optsOrCb, maybeCb) => {
    const cb = typeof optsOrCb === 'function' ? optsOrCb : maybeCb;
    queueMicrotask(() => behavior(cmd, cb));
  });
}

describe('extractFrame — fast-seek with slow-seek fallback', () => {
  let tmpDir;
  let videoPath;
  let outputPath;

  beforeEach(() => {
    execMock.mockReset();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'extract-frame-'));
    videoPath = path.join(tmpDir, 'video.webm');
    outputPath = path.join(tmpDir, 'frame.jpg');
    fs.writeFileSync(videoPath, 'fake');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns after fast seek when it produces a non-empty file', async () => {
    stubExec((cmd, cb) => {
      fs.writeFileSync(outputPath, Buffer.alloc(500, 1));
      cb(null, { stdout: '', stderr: '' });
    });

    await extractFrame(videoPath, 42, outputPath);

    expect(execMock).toHaveBeenCalledTimes(1);
    const cmd = execMock.mock.calls[0][0];
    expect(cmd).toMatch(/-ss 42 -i /);
  });

  it('falls back to slow seek when fast seek exits 0 with an empty file', async () => {
    const sizes = [0, 700];
    stubExec((cmd, cb) => {
      fs.writeFileSync(outputPath, Buffer.alloc(sizes.shift(), 1));
      cb(null, { stdout: '', stderr: 'Output file is empty' });
    });

    await extractFrame(videoPath, 230, outputPath);

    expect(execMock).toHaveBeenCalledTimes(2);
    expect(execMock.mock.calls[0][0]).toMatch(/-ss 230 -i /);
    expect(execMock.mock.calls[1][0]).toMatch(/-i ".+" -ss 230/);
    expect(fs.statSync(outputPath).size).toBeGreaterThan(0);
  });

  it('throws when even slow seek produces an empty file', async () => {
    stubExec((cmd, cb) => {
      fs.writeFileSync(outputPath, Buffer.alloc(0));
      cb(null, { stdout: '', stderr: '' });
    });

    await expect(extractFrame(videoPath, 100, outputPath)).rejects.toThrow(/empty output at 100s/);
    expect(execMock).toHaveBeenCalledTimes(2);
  });

  it('throws when slow seek command itself fails', async () => {
    let call = 0;
    stubExec((cmd, cb) => {
      call++;
      if (call === 1) {
        fs.writeFileSync(outputPath, Buffer.alloc(0));
        cb(null, { stdout: '', stderr: '' });
      } else {
        const err = new Error('boom');
        err.stderr = 'ffmpeg decode error';
        cb(err, { stdout: '', stderr: 'ffmpeg decode error' });
      }
    });

    await expect(extractFrame(videoPath, 50, outputPath)).rejects.toThrow(/extractFrame failed at 50s/);
  });
});

describe('concatRecorderSegments — split uploaded multi-segment WebM by byte offsets', () => {
  let tmpDir;
  let videoPath;

  beforeEach(() => {
    execMock.mockReset();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'recseg-'));
    videoPath = path.join(tmpDir, 'video.webm');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('no-ops for single-segment uploads (no ffmpeg call)', async () => {
    fs.writeFileSync(videoPath, Buffer.from('abc'));
    await concatRecorderSegments(videoPath, [3]);
    expect(execMock).not.toHaveBeenCalled();
    expect(fs.readFileSync(videoPath).toString()).toBe('abc');
  });

  it('no-ops when segmentSizes is missing or empty', async () => {
    fs.writeFileSync(videoPath, Buffer.from('abc'));
    await concatRecorderSegments(videoPath, null);
    await concatRecorderSegments(videoPath, []);
    expect(execMock).not.toHaveBeenCalled();
  });

  it('splits the file by byte offsets, runs concat demuxer, and replaces original', async () => {
    const segA = Buffer.from('AAAAA');      // 5 bytes
    const segB = Buffer.from('BBBBBBBBBB'); // 10 bytes
    fs.writeFileSync(videoPath, Buffer.concat([segA, segB]));

    let capturedListContent = null;
    stubExec((cmd, cb) => {
      // Simulate ffmpeg reading the concat list and producing the output
      const listMatch = cmd.match(/-i "([^"]+concat_list\.txt)"/);
      if (listMatch) capturedListContent = fs.readFileSync(listMatch[1], 'utf8');
      const outMatch = cmd.match(/"([^"]+\.recjoined\.webm)"$/);
      if (outMatch) fs.writeFileSync(outMatch[1], 'STITCHED');
      cb(null, { stdout: '', stderr: '' });
    });

    await concatRecorderSegments(videoPath, [5, 10]);

    expect(execMock).toHaveBeenCalledTimes(1);
    expect(execMock.mock.calls[0][0]).toMatch(/-f concat -safe 0/);
    expect(execMock.mock.calls[0][0]).toMatch(/-c copy/);

    // Concat list referenced both per-segment files
    expect(capturedListContent).toContain('recseg_0.webm');
    expect(capturedListContent).toContain('recseg_1.webm');

    // Original replaced with ffmpeg output
    expect(fs.readFileSync(videoPath).toString()).toBe('STITCHED');

    // Per-segment files and concat list cleaned up
    expect(fs.existsSync(path.join(tmpDir, 'recseg_0.webm'))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, 'recseg_1.webm'))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, 'recorder_concat_list.txt'))).toBe(false);
  });

  it('throws (and leaves original untouched) when sizes do not match the file', async () => {
    fs.writeFileSync(videoPath, Buffer.from('only 9 bytes'.slice(0, 9)));
    await expect(concatRecorderSegments(videoPath, [5, 10])).rejects.toThrow(/sum to 15 but file is 9/);
    expect(execMock).not.toHaveBeenCalled();
    expect(fs.readFileSync(videoPath).length).toBe(9);
  });

  it('throws and cleans up temp files if ffmpeg concat fails', async () => {
    fs.writeFileSync(videoPath, Buffer.concat([Buffer.alloc(3, 1), Buffer.alloc(4, 2)]));

    stubExec((cmd, cb) => {
      const err = new Error('boom');
      err.stderr = 'invalid EBML';
      cb(err, { stdout: '', stderr: 'invalid EBML' });
    });

    await expect(concatRecorderSegments(videoPath, [3, 4])).rejects.toThrow(/concatRecorderSegments failed/);
    expect(fs.existsSync(path.join(tmpDir, 'recseg_0.webm'))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, 'recseg_1.webm'))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, 'recorder_concat_list.txt'))).toBe(false);
  });
});
