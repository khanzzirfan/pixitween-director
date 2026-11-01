import { afterEach, describe, expect, it } from 'vitest';
import { readSeedBuffer } from '../test-utils/fixtures';
import { FfmpegMissingError, extractFrames, hasFfmpeg, probeVideo, runFfmpeg, toWav16kMono } from './ffmpeg';
import { imageSize } from './image';

const has = await hasFfmpeg();

describe.skipIf(!has)('with ffmpeg', () => {
  it('toWav16kMono gives a 16 kHz mono WAV of about 10 s', async () => {
    const wav = await toWav16kMono(readSeedBuffer('brief-16k.wav'));
    expect(wav.subarray(0, 4).toString()).toBe('RIFF');
    expect(wav.subarray(8, 12).toString()).toBe('WAVE');
    expect(wav.readUInt16LE(22)).toBe(1);
    expect(wav.readUInt32LE(24)).toBe(16000);
    const byteRate = wav.readUInt32LE(28);
    expect(Math.abs((wav.length - 44) / byteRate - 10)).toBeLessThan(0.1);
  });

  it('probes and extracts frames from a generated video', async () => {
    const { stdout } = await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=30', '-t', '2', '-pix_fmt', 'yuv420p', '-f', 'matroska', '-']);
    const info = await probeVideo(stdout);
    expect(info).toMatchObject({ width: 320, height: 180, fps: 30, frames: 60 });
    expect(Math.abs(info.durationSec - 2)).toBeLessThan(0.1);
    const frames = await extractFrames(stdout, [0.5, 1.5], { width: 160 });
    expect(frames).toHaveLength(2);
    for (const f of frames) expect((await imageSize(f)).width).toBe(160);
  });
});

describe('without ffmpeg', () => {
  const prev = process.env.FFMPEG_PATH;
  afterEach(() => {
    if (prev === undefined) delete process.env.FFMPEG_PATH;
    else process.env.FFMPEG_PATH = prev;
  });
  it('degrades cleanly', async () => {
    process.env.FFMPEG_PATH = '/nonexistent/ffmpeg';
    expect(await hasFfmpeg()).toBe(false);
    await expect(toWav16kMono(Buffer.from('x'))).rejects.toBeInstanceOf(FfmpegMissingError);
  });
});
