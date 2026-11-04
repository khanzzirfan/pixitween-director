import sharp from 'sharp';
import { expect, it } from 'vitest';
import { makeTestFilm } from '../test-utils/film';
import { prepareProduct3D, newPrepareCache } from './prepare';
import { flacon, stripedCan, triangle, type Rgba } from './test-images';

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

it("outlines a flacon asked as a bottle, so the ornate cap is not replaced by a plain bottle neck", async () => {
  const t = await setup(flacon());
  const r = await prepareProduct3D(t.assets, { cutoutAssetId: t.cut.id, shape: 'bottle' }, newPrepareCache());
  expect(r.shape).toBe('other');
  expect(r.fallback).toBe('extrude');
});

const solid = (colour: string, w = 200, h = 400) => sharp({ create: { width: w, height: h, channels: 4, background: colour } }).png().toBuffer();

it('gives a body a back texture the size of its front, and leaves the front texture as it was', async () => {
  const t = await setup(triangle());
  const plain = await prepareProduct3D(t.assets, { cutoutAssetId: t.cut.id, shape: 'other' }, newPrepareCache());
  const turned = await prepareProduct3D(t.assets, { cutoutAssetId: t.cut.id, shape: 'other', back: await solid('#3366cc') }, newPrepareCache());
  expect(plain.back).toBeUndefined();
  expect(turned.textureKind).toBe('front');
  expect(await t.assets.read(turned.texture.id)).toEqual(await t.assets.read(plain.texture.id));
  const m = await sharp(await t.assets.read(turned.back!.id)).metadata();
  expect([m.width, m.height]).toEqual([turned.texture.width, turned.texture.height]);
});

it('wraps a can all the way round with a back, and keeps the 2048 x 1024 strip', async () => {
  const t = await setup(stripedCan().img);
  const plain = await prepareProduct3D(t.assets, { cutoutAssetId: t.cut.id, shape: 'can' }, newPrepareCache());
  const turned = await prepareProduct3D(t.assets, { cutoutAssetId: t.cut.id, shape: 'can', back: await solid('#3366cc') }, newPrepareCache());
  expect(turned.shape).toBe('can');
  const m = await sharp(await t.assets.read(turned.texture.id)).metadata();
  expect([m.width, m.height]).toEqual([2048, 1024]);
  const raw = async (id: string) => (await sharp(await t.assets.read(id)).removeAlpha().raw().toBuffer());
  // the front column is the same, the column at 180 degrees is the drawn back's blue
  const [a, b] = [await raw(plain.texture.id), await raw(turned.texture.id)];
  const at = (buf: Buffer, u: number) => [buf[(512 * 2048 + u) * 3]!, buf[(512 * 2048 + u) * 3 + 1]!, buf[(512 * 2048 + u) * 3 + 2]!];
  expect(at(b, 1024)).toEqual(at(a, 1024));
  expect(at(b, 0)[2]).toBeGreaterThan(at(b, 0)[0]!);
});

it('keeps a back view out of the cache key of the plain product', async () => {
  const t = await setup(triangle());
  const cache = newPrepareCache();
  const plain = await prepareProduct3D(t.assets, { cutoutAssetId: t.cut.id, shape: 'other' }, cache);
  const turned = await prepareProduct3D(t.assets, { cutoutAssetId: t.cut.id, shape: 'other', back: await solid('#3366cc') }, cache);
  expect(turned).not.toBe(plain);
  expect(await prepareProduct3D(t.assets, { cutoutAssetId: t.cut.id, shape: 'other' }, cache)).toBe(plain);
});

it('gives a body its side picture, as tall as the front texture, and no profile without a side', async () => {
  const t = await setup(triangle());
  const turned = await prepareProduct3D(t.assets, { cutoutAssetId: t.cut.id, shape: 'other', back: await solid('#3366cc'), side: await solid('#33cc66', 120, 400) }, newPrepareCache());
  expect(turned.profile).toBeDefined();
  const m = await sharp(await t.assets.read(turned.profile!.id)).metadata();
  expect(m.height).toBe(turned.texture.height);
  expect((await prepareProduct3D(t.assets, { cutoutAssetId: t.cut.id, shape: 'other', back: await solid('#3366cc') }, newPrepareCache())).profile).toBeUndefined();
});
