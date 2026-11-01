import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { makeSyntheticFrames } from './synth-frames';

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

describe('makeSyntheticFrames', () => {
  it('returns four 1280x720 JPEGs in order', async () => {
    const frames = await makeSyntheticFrames();
    expect(frames.map((f) => f.name)).toEqual(['clean', 'text-over-product', 'low-contrast', 'product-missing']);
    for (const f of frames) {
      expect([...f.jpeg.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
      const m = await sharp(f.jpeg).metadata();
      expect([m.width, m.height]).toEqual([1280, 720]);
      expect(f.atSec).toBe(1);
    }
  });

  it('makes four different pictures, and the same ones every time', async () => {
    const a = await makeSyntheticFrames();
    expect(new Set(a.map((f) => sha(f.jpeg))).size).toBe(4);
    const b = await makeSyntheticFrames();
    expect(b.map((f) => sha(f.jpeg))).toEqual(a.map((f) => sha(f.jpeg)));
  });

  it('says what a reviewer should find in each', async () => {
    const e = Object.fromEntries((await makeSyntheticFrames()).map((f) => [f.name, f.expected]));
    expect(e.clean).toEqual({ pass: true, kinds: [] });
    expect(e['text-over-product']).toEqual({ pass: false, kinds: ['text-over-product'] });
    expect(e['low-contrast']).toEqual({ pass: false, kinds: ['low-contrast'] });
    expect(e['product-missing']).toEqual({ pass: false, kinds: ['product-hidden'] });
  });

  it('draws something on every frame, so none is skipped as blank', async () => {
    for (const f of await makeSyntheticFrames()) expect((await sharp(f.jpeg).stats()).channels.some((c) => c.stdev > 1)).toBe(true);
  });

  // set WRITE_SYNTH=dir to look at the four pictures
  it.skipIf(!process.env.WRITE_SYNTH)('can write the frames out for a look', async () => {
    mkdirSync(process.env.WRITE_SYNTH!, { recursive: true });
    for (const f of await makeSyntheticFrames()) writeFileSync(`${process.env.WRITE_SYNTH}/${f.name}.jpg`, f.jpeg);
  });
});
