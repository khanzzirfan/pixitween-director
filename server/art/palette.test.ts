import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { dominantAccent } from './palette';

const solid = (r: number, g: number, b: number, a = 255) => sharp({ create: { width: 20, height: 20, channels: 4, background: { r, g, b, alpha: a / 255 } } }).png().toBuffer();

describe('dominantAccent', () => {
  it('takes the saturated colour, not the cream around it', async () => {
    // a cream 20x20 with a brown band across the middle
    const band = await sharp({ create: { width: 20, height: 6, channels: 4, background: { r: 110, g: 50, b: 20, alpha: 1 } } }).png().toBuffer();
    const img = await sharp(await solid(240, 230, 205)).composite([{ input: band, top: 7, left: 0 }]).png().toBuffer();
    const a = await dominantAccent(img);
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(a.hex.slice(i, i + 2), 16));
    expect(r!).toBeGreaterThan(95);
    expect(r!).toBeLessThan(130);
    expect(r! - b!).toBeGreaterThan(50); // brown, not cream
    expect(g!).toBeLessThan(r!);
    expect(a.chroma).toBeGreaterThan(0.1);
  });
  it('reports no accent for white, grey, black and see-through images', async () => {
    for (const buf of [await solid(250, 250, 250), await solid(128, 128, 128), await solid(5, 5, 5), await solid(200, 40, 40, 0)]) {
      expect((await dominantAccent(buf)).chroma).toBe(0);
    }
  });
});
