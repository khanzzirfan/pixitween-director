import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { decode, trim } from './codec';
import { findBodyBand, unwrapCylinder, LABEL_HEIGHT, LABEL_WIDTH } from './unwrap';
import { sideColour } from './colour';
import { wrapStrip } from './wrap360';

const bar = (colour: string, w = 200, h = 400) => sharp({ create: { width: w, height: h, channels: 4, background: colour } }).png().toBuffer();
const pixel = async (png: Buffer, u: number, v = 500) => {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const i = (v * info.width + u) * 4;
  return [data[i]!, data[i + 1]!, data[i + 2]!];
};
const near = (a: number[], b: number[], d = 3) => a.every((x, i) => Math.abs(x - b[i]!) <= d);

describe('wrapStrip', () => {
  it('is LABEL_WIDTH x LABEL_HEIGHT, with the front column at angle 0 equal to the front unwrap and the column at 180 the back colour', async () => {
    const strip = (await wrapStrip({ front: await bar('#cc2222'), back: await bar('#2222cc') }))!;
    const m = await sharp(strip).metadata();
    expect([m.width, m.height]).toEqual([LABEL_WIDTH, LABEL_HEIGHT]);
    const front = trim(await decode(await bar('#cc2222')));
    const band = findBodyBand(front)!;
    const today = unwrapCylinder(front, band, sideColour(front, band));
    const mid = LABEL_WIDTH / 2;
    expect(await pixel(strip, mid)).toEqual([today.data[(500 * LABEL_WIDTH + mid) * 4]!, today.data[(500 * LABEL_WIDTH + mid) * 4 + 1]!, today.data[(500 * LABEL_WIDTH + mid) * 4 + 2]!]);
    expect(near(await pixel(strip, mid), [204, 34, 34])).toBe(true);
    expect(near(await pixel(strip, 0), [34, 34, 204])).toBe(true);
    expect(near(await pixel(strip, LABEL_WIDTH - 1), [34, 34, 204])).toBe(true);
  });
  it('crosses from the front to the back over the seam, not in one jump', async () => {
    const strip = (await wrapStrip({ front: await bar('#ff0000'), back: await bar('#0000ff') }))!;
    const at = (deg: number) => Math.round((deg / 360 + 0.5) * LABEL_WIDTH);
    expect((await pixel(strip, at(80)))[0]).toBeGreaterThan(240);
    const mid = (await pixel(strip, at(90)))[0]!;
    expect(mid).toBeGreaterThan(60);
    expect(mid).toBeLessThan(200);
    expect((await pixel(strip, at(100)))[2]).toBeGreaterThan(240);
  });
  it('is undefined when the back has no straight body band', async () => {
    const cone = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="400"><polygon points="100,0 200,400 0,400" fill="#2222cc"/></svg>')).png().toBuffer();
    expect(await wrapStrip({ front: await bar('#cc2222'), back: cone })).toBeUndefined();
  });
});
