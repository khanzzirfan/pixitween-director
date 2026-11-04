import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { composeSheet, labelCrop, swatchesOf } from './compose';

const solid = (w: number, h: number, c: string) => sharp({ create: { width: w, height: h, channels: 3, background: c } }).png().toBuffer();
const near = (a: string, b: string) => Math.hypot(...[1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16))) / (255 * Math.sqrt(3)) < 0.05;

describe('composeSheet', () => {
  it('lays 5 panels in 3 columns as a landscape JPEG of 2 rows', async () => {
    const panels = await Promise.all(['#f00', '#0f0', '#00f', '#ff0', '#0ff'].map(async (c, i) => ({ png: await solid(200, 300, c), label: `panel ${i}` })));
    const jpeg = await composeSheet({ title: 'Product sheet', panels, columns: 3, swatches: ['#ff0000', '#0000ff'] });
    const m = await sharp(jpeg).metadata();
    expect(m.format).toBe('jpeg');
    expect(m.width!).toBeGreaterThan(m.height!);
    expect(m.width).toBe(1440);
  });
});

describe('swatchesOf', () => {
  it('finds the red and the blue of a half-and-half picture', async () => {
    const left = await solid(32, 64, '#ff0000');
    const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#0000ff' } }).composite([{ input: left, left: 0, top: 0 }]).png().toBuffer();
    const s = await swatchesOf(png);
    expect(s).toHaveLength(2);
    expect(s.some((c) => near(c, '#ff0000'))).toBe(true);
    expect(s.some((c) => near(c, '#0000ff'))).toBe(true);
  });
});

describe('labelCrop', () => {
  it('keeps the middle 50 % across and 40 % down', async () => {
    const crop = await labelCrop(await solid(400, 400, '#888'));
    const m = await sharp(crop).metadata();
    expect([m.width, m.height, m.format]).toEqual([200, 160, 'png']);
  });
});
