import sharp from 'sharp';
import { expect, it } from 'vitest';
import { makeTestFilm } from '../test-utils/film';
import { prepareProduct3D, newPrepareCache } from './prepare';
import { stripedCan, triangle, type Rgba } from './test-images';

const png = (img: Rgba) => sharp(Buffer.from(img.data.buffer), { raw: { width: img.width, height: img.height, channels: 4 } }).png().toBuffer();
async function setup(img: Rgba) {
  const t = await makeTestFilm();
  const cut = await t.assets.put(await png(img), 'image/png', { role: 'cutout', width: img.width, height: img.height });
  return { ...t, cut };
}

it("stores one asset with role 'label' for the test can and returns shape 'can'", async () => {
  const t = await setup(stripedCan().img);
  const before = (await t.assets.list()).length;
  const r = await prepareProduct3D(t.assets, { cutoutAssetId: t.cut.id, shape: 'can' }, newPrepareCache());
  expect(r.shape).toBe('can');
  expect(r.textureKind).toBe('label');
  expect(r.texture).toMatchObject({ role: 'label', width: 2048, height: 1024 });
  expect((await t.assets.list()).length).toBe(before + 1);
  expect(r.side).toMatch(/^#[0-9a-f]{6}$/);
  expect(r.contour).toBeUndefined();
  // the asset is a real 2048 x 1024 PNG
  const meta = await sharp(await t.assets.read(r.texture.id)).metadata();
  expect([meta.width, meta.height]).toEqual([2048, 1024]);
});

it("falls back to 'other' with a contour and a front cropped to its bounding box for a triangle asked as a can", async () => {
  const t = await setup(triangle());
  const r = await prepareProduct3D(t.assets, { cutoutAssetId: t.cut.id, shape: 'can' }, newPrepareCache());
  expect(r.shape).toBe('other');
  expect(r.fallback).toBe('extrude');
  expect(r.textureKind).toBe('front');
  expect(r.contour!.length).toBeGreaterThanOrEqual(3);
  const xs = r.contour!.map((p) => p[0]);
  const ys = r.contour!.map((p) => p[1]);
  const meta = await sharp(await t.assets.read(r.texture.id)).metadata();
  // the front is the contour's own box: the contour reaches each edge of it
  expect(Math.min(...xs)).toBeLessThanOrEqual(1);
  expect(Math.min(...ys)).toBeLessThanOrEqual(1);
  expect(meta.width!).toBeGreaterThan(Math.max(...xs) - 2);
  expect(meta.height!).toBeGreaterThan(Math.max(...ys) - 2);
  expect(meta.width!).toBeLessThan(300); // cropped from the 300 x 300 triangle image
});

it('stores no new asset on a second call with the same cut-out and shape', async () => {
  const t = await setup(stripedCan().img);
  const cache = newPrepareCache();
  const a = await prepareProduct3D(t.assets, { cutoutAssetId: t.cut.id, shape: 'can' }, cache);
  const count = (await t.assets.list()).length;
  const b = await prepareProduct3D(t.assets, { cutoutAssetId: t.cut.id, shape: 'can' }, cache);
  expect(b).toBe(a);
  expect((await t.assets.list()).length).toBe(count);
});

it('keeps the photo as the front of a box', async () => {
  const t = await setup(stripedCan().img);
  const r = await prepareProduct3D(t.assets, { cutoutAssetId: t.cut.id, shape: 'box' }, newPrepareCache());
  expect(r.shape).toBe('box');
  expect(r.textureKind).toBe('front');
});

it('records the time the image work takes on the test can', async () => {
  const t = await setup(stripedCan().img);
  const start = performance.now();
  await prepareProduct3D(t.assets, { cutoutAssetId: t.cut.id, shape: 'can' }, newPrepareCache());
  console.log(`prepare (can, 300 x 500 test image): ${Math.round(performance.now() - start)} ms`);
  expect(performance.now() - start).toBeLessThan(5000);
});
