import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Mock child_process.exec before importing ffmpeg.js, since execAsync is
// created at module load time from promisify(exec).
const execMock = vi.fn();
vi.mock('child_process', () => ({ exec: (...args) => execMock(...args) }));

const { extractFrame } = await import('../../services/ffmpeg.js');

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
