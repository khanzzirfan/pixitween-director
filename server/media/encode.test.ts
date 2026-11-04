import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildEncodeArgs, encodeFrames, frameName } from './encode';
import { hasFfmpeg, probeVideo } from './ffmpeg';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

let dir: string;
beforeEach(async () => void (dir = await mkdtemp(join(tmpdir(), 'encode-test-'))));
afterEach(async () => rm(dir, { recursive: true, force: true }));

describe('frameName and buildEncodeArgs', () => {
  it('numbers frames with five digits and the chosen extension', () => {
    expect(frameName(0)).toBe('f00000.jpg');
    expect(frameName(239)).toBe('f00239.jpg');
    expect(frameName(3, 'png')).toBe('f00003.png');
  });

  it('builds the web-safe H.264 arguments', () => {
    const a = buildEncodeArgs({ framesDir: 'd', fps: 30, out: 'o.mp4' });
    expect(a).toContain('d/f%05d.jpg');
    expect(a.join(' ')).toContain('-pix_fmt yuv420p');
    expect(a.join(' ')).toContain('-movflags +faststart');
    expect(a.join(' ')).toContain('out_range=tv,format=yuv420p');
    expect(a.at(-1)).toBe('o.mp4');
    const b = buildEncodeArgs({ framesDir: 'd', fps: 30, out: 'o.mp4', crf: 23 });
    expect(b.filter((x, i) => x !== a[i])).toEqual(['23']);
  });
});

describe('encodeFrames', () => {
  it('rejects an empty folder without calling the runner', async () => {
    const run = vi.fn();
    await expect(encodeFrames({ framesDir: dir, fps: 30, out: join(dir, 'o.mp4') }, run)).rejects.toThrow('no frames');
    expect(run).not.toHaveBeenCalled();
  });

  it('calls the runner once with the built args', async () => {
    for (let i = 0; i < 3; i++) await writeFile(join(dir, frameName(i)), 'x');
    const run = vi.fn().mockResolvedValue({ stdout: Buffer.alloc(0), stderr: '' });
    const o = { framesDir: dir, fps: 12, out: join(dir, 'o.mp4') };
    await encodeFrames(o, run);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(buildEncodeArgs(o), { timeoutMs: 300000 });
  });
});

describe.skipIf(!(await hasFfmpeg()))('with ffmpeg', () => {
  it('encodes 12 colour frames into a 64x64 MP4 of 12 frames', async () => {
    for (let i = 0; i < 12; i++) {
      const jpg = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: i * 20, g: 255 - i * 20, b: 90 } } }).jpeg().toBuffer();
      await writeFile(join(dir, frameName(i)), jpg);
    }
    const out = join(dir, 'o.mp4');
    await encodeFrames({ framesDir: dir, fps: 12, out });
    const info = await probeVideo(await readFile(out));
    expect(info).toMatchObject({ width: 64, height: 64, frames: 12 });
    // JPEG frames must not leak full range (yuvj420p) into the MP4: QuickTime and some browsers mis-render it
    expect(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=pix_fmt,color_range', '-of', 'csv=p=0', out]).toString().trim()).toBe('yuv420p,tv');
  });
});
