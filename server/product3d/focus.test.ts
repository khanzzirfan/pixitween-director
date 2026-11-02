import { describe, expect, it } from 'vitest';
import { detailFocus } from './focus';
import { blank, put, type Rgba } from './pixels';

/** A solid grey product with a checkered patch (a logo) at the given pixel box. */
function withLogo(w: number, h: number, box: [number, number, number, number]): Rgba {
  const img = blank(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) put(img, x, y, [120, 120, 120]);
  for (let y = box[1]; y < box[3]; y++) for (let x = box[0]; x < box[2]; x++) if (((x >> 2) + (y >> 2)) % 2) put(img, x, y, [250, 250, 250]);
  return img;
}

describe('detailFocus', () => {
  it('finds the logo patch, not the plain body', () => {
    const [u, v] = detailFocus(withLogo(200, 300, [120, 40, 190, 110]));
    expect(u).toBeGreaterThan(0.55);
    expect(v).toBeLessThan(0.45);
  });
  it('finds a logo low on the product', () => {
    const [u, v] = detailFocus(withLogo(200, 300, [10, 220, 80, 290]));
    expect(u).toBeLessThan(0.45);
    expect(v).toBeGreaterThan(0.6);
  });
  it('is the middle for a plain picture, an empty one and a tiny one', () => {
    const plain = blank(200, 200);
    for (let i = 0; i < 200 * 200; i++) put(plain, i % 200, Math.floor(i / 200), [90, 90, 90]);
    expect(detailFocus(plain)).toEqual([0.5, 0.5]);
    expect(detailFocus(blank(200, 200))).toEqual([0.5, 0.5]);
    expect(detailFocus(blank(8, 8))).toEqual([0.5, 0.5]);
  });
  it('a long straight stripe loses to a small patch with strokes both ways', () => {
    const img = withLogo(240, 300, [20, 200, 100, 280]);
    // a high-contrast stripe, one direction only, across the top: more edge energy than the patch, but only horizontal
    for (let y = 40; y < 52; y++) for (let x = 0; x < 240; x++) put(img, x, y, [0, 0, 0]);
    const [u, v] = detailFocus(img);
    expect(v).toBeGreaterThan(0.6);
    expect(u).toBeLessThan(0.5);
  });
  it('ignores the product outline: a transparent margin with a hard edge is not detail', () => {
    const img = blank(200, 200);
    for (let y = 50; y < 150; y++) for (let x = 50; x < 150; x++) put(img, x, y, y < 100 ? [30, 30, 30] : [220, 220, 220]);
    const [u, v] = detailFocus(img);
    expect(u).toBeGreaterThan(0.2);
    expect(u).toBeLessThan(0.8);
    expect(v).toBeGreaterThan(0.2);
    expect(v).toBeLessThan(0.8);
  });
});
