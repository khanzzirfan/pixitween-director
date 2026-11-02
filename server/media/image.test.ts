import sharp from 'sharp';
import { expect, it } from 'vitest';
import { readSeedBuffer } from '../test-utils/fixtures';
import { alphaCutout, flatten, imageSize, resizeFit } from './image';

const solid = (w: number, h: number, r: number, g: number, b: number) =>
  sharp({ create: { width: w, height: h, channels: 4, background: { r, g, b, alpha: 1 } } }).png().toBuffer();

const px = async (png: Buffer, x: number, y: number) => {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  const o = (y * info.width + x) * info.channels;
  return [...data.subarray(o, o + info.channels)];
};

const rectAlpha = () => {
  const a = Buffer.alloc(960 * 640);
  for (let y = 160; y < 480; y++) a.fill(255, y * 960 + 240, y * 960 + 720);
  return a;
};

it('imageSize', async () => {
  expect(await imageSize(readSeedBuffer('mug-cutout-rgba.png'))).toEqual({ width: 960, height: 640, mime: 'image/png' });
  expect(await imageSize(readSeedBuffer('cafe-with-mug.jpg'))).toEqual({ width: 960, height: 640, mime: 'image/jpeg' });
  await expect(imageSize(Buffer.from('nope'))).rejects.toThrow();
});

it('alphaCutout applies the mask', async () => {
  const out = await alphaCutout(readSeedBuffer('cafe-with-mug.jpg'), rectAlpha());
  expect((await px(out, 480, 320))[3]).toBe(255);
  expect((await px(out, 10, 10))[3]).toBe(0);
});

it('feather softens the edge', async () => {
  const out = await alphaCutout(readSeedBuffer('cafe-with-mug.jpg'), rectAlpha(), { feather: 3 });
  const a = (await px(out, 240, 320))[3]!;
  expect(a).toBeGreaterThan(0);
  expect(a).toBeLessThan(255);
});

it('alphaCutout rejects a wrong-length alpha', async () => {
  await expect(alphaCutout(readSeedBuffer('cafe-with-mug.jpg'), Buffer.alloc(10))).rejects.toThrow();
});

it('flatten composes layers', async () => {
  const out = await flatten(
    [{ png: await solid(10, 10, 255, 0, 0), left: 0, top: 0 }, { png: await solid(10, 10, 0, 0, 255), left: 5, top: 5 }],
    { width: 20, height: 20 },
  );
  expect(await imageSize(out)).toMatchObject({ width: 20, height: 20 });
  expect((await px(out, 7, 7)).slice(0, 3)).toEqual([0, 0, 255]);
  expect((await px(out, 19, 19))[3]).toBe(0);
});

it('resizeFit shrinks but never enlarges', async () => {
  const r = await resizeFit(readSeedBuffer('cafe-with-mug.jpg'), 480, 'png');
  expect(await imageSize(r)).toMatchObject({ width: 480, height: 320 });
  const small = await sharp({ create: { width: 100, height: 50, channels: 3, background: '#fff' } }).png().toBuffer();
  expect(await imageSize(await resizeFit(small, 480, 'jpeg'))).toMatchObject({ width: 100, height: 50 });
});
