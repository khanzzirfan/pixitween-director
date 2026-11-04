import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { backTexture, sideTexture } from './back';

const grey = (w: number, h: number, v: number, alpha = 255) => sharp({ create: { width: w, height: h, channels: 4, background: { r: v, g: v, b: v, alpha: alpha / 255 } } }).png().toBuffer();
const rawOf = async (png: Buffer) => sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const meanOpaque = async (png: Buffer) => {
  const { data } = await rawOf(png);
  let sum = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += 4) if (data[i + 3]! > 127) { sum += data[i]!; n++; }
  return sum / n;
};
/** a w x h RGBA picture: `fill(x, y)` gives [grey, alpha] */
const picture = (w: number, h: number, fill: (x: number, y: number) => [number, number]) => {
  const raw = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [v, a] = fill(x, y);
      raw.fill(v, (y * w + x) * 4, (y * w + x) * 4 + 3);
      raw[(y * w + x) * 4 + 3] = a;
    }
  return sharp(raw, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
};

describe('backTexture', () => {
  it("is exactly the front texture's size", async () => {
    const m = await sharp(await backTexture({ back: await grey(300, 700, 100), front: await grey(120, 260, 160) })).metadata();
    expect([m.width, m.height]).toEqual([120, 260]);
  });
  it("brings the back's mean colour to the front's (100 against 160)", async () => {
    expect(Math.abs((await meanOpaque(await backTexture({ back: await grey(300, 700, 100), front: await grey(120, 260, 160) }))) - 160)).toBeLessThan(3);
  });
  it("takes the front's outline mirrored: clear where the mirrored front is clear, whatever the drawing", async () => {
    // the front has a notch on its right edge (a handle gap): the back, seen from behind, has it on its left
    const front = await picture(100, 100, (x, y) => [150, x >= 80 && y >= 40 && y < 60 ? 0 : 255]);
    const out = await rawOf(await backTexture({ back: await grey(100, 100, 150), front }));
    const alpha = (x: number, y: number) => out.data[(y * out.info.width + x) * 4 + 3];
    expect(alpha(10, 50)).toBe(0);
    expect(alpha(90, 50)).toBe(255);
    expect(alpha(10, 10)).toBe(255);
  });
  it("carries the drawing's edge out where it falls short of the outline, so the body has no hole there (the perfume's sides, 4 Nov)", async () => {
    // the drawn back is clear in a band down its middle, dark on the left and light on the right; the front is solid
    const back = await picture(100, 100, (x) => (x >= 45 && x < 55 ? [0, 0] : [x < 45 ? 60 : 200, 255]));
    const out = await rawOf(await backTexture({ back, front: await grey(100, 100, 130) }));
    const px = (x: number) => out.data[(50 * out.info.width + x) * 4]!;
    expect(out.data[(50 * out.info.width + 50) * 4 + 3]).toBe(255);
    // a filled pixel takes its nearest drawn neighbour: left of the middle the dark side, right of it the light side
    expect(px(46)).toBe(px(40));
    expect(px(54)).toBe(px(60));
  });
});

describe('sideTexture', () => {
  it('is as tall as the front, keeps the side view\'s own width share, and is opaque edge to edge', async () => {
    const side = await picture(50, 200, (x) => [90, x < 10 || x >= 40 ? 0 : 255]);
    const out = await rawOf(await sideTexture({ side, front: await grey(120, 400, 160) }));
    expect(out.info.height).toBe(400);
    // the side view trims to 30 x 200, so at 400 tall it is 60 wide
    expect(Math.abs(out.info.width - 60)).toBeLessThanOrEqual(1);
    for (let i = 3; i < out.data.length; i += 4) expect(out.data[i]).toBe(255);
    expect(Math.abs(out.data[(200 * out.info.width + 30) * 4]! - 160)).toBeLessThan(3);
  });
});
