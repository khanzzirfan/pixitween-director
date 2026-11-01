import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { isFlatImage, imageSize } from '../media/image';
import { makeTestFilm } from '../test-utils/film';
import { fakeArt, realArt } from './art';

const CAN = 'fixtures/s13/can-product.png';

it('cuts a photo into an asset for free', async () => {
  const { assets } = await makeTestFilm();
  const art = fakeArt(assets);

  const cut = await art.cut(readFileSync(CAN), 'can');

  expect(cut.usd).toBe(0);
  expect(cut.width).toBeGreaterThan(0);
  expect(cut.height).toBeGreaterThan(0);
  expect(cut.accent).toMatch(/^#[0-9a-f]{6}$/);
  const ref = await assets.get(cut.id);
  expect(ref.role).toBe('cutout');
  expect((await assets.read(cut.id)).length).toBeGreaterThan(0);
  // the photo is trimmed, so the cut-out is smaller than the photo it came from
  const source = await imageSize(readFileSync(CAN));
  expect(cut.width).toBeLessThan(source.width);
  expect(cut.height).toBeLessThan(source.height);
});

it('paints a flat plate for free', async () => {
  const { assets } = await makeTestFilm();
  const art = fakeArt(assets);

  const plate = await art.plate('tabletop-hero', 'everyday', 'can', '9:16');

  expect(plate.usd).toBe(0);
  expect(plate.width).toBe(720);
  expect(plate.height).toBe(1280);
  const ref = await assets.get(plate.id);
  expect(ref.role).toBe('plate');
  const bytes = await assets.read(plate.id);
  expect(bytes.length).toBeGreaterThan(0);
  expect(await isFlatImage(bytes)).toBe(true);
});

it('counts every cut and every plate', async () => {
  const { assets } = await makeTestFilm();
  const art = fakeArt(assets);

  await art.cut(readFileSync(CAN), 'can');
  await art.plate('tabletop-hero', 'everyday', 'can', '9:16');
  await art.plate('flat-lay', 'everyday', 'can', '9:16');

  expect(art.calls).toEqual({ cut: 1, plate: 2 });
});

it('the real art calls SAM and Muse and says what it cost', async () => {
  // The meta clients are the offline fakes, so this proves the wiring, not the models.
  const { ctx, assets, meta } = await makeTestFilm();
  const art = realArt(ctx, assets);

  const cut = await art.cut(readFileSync(CAN), 'can');
  expect(cut.usd).toBe(0.0025);
  expect(cut.width).toBeGreaterThan(0);
  expect(cut.height).toBeGreaterThan(0);
  expect(meta.calls.some((c) => c.client === 'sam' && c.method === 'segmentImage')).toBe(true);
  expect((await assets.read(cut.id)).length).toBeGreaterThan(0);

  const plate = await art.plate('tabletop-hero', 'everyday', 'can', '9:16');
  expect(plate.usd).toBe(0.01);
  expect(plate.width).toBe(720);
  expect(plate.height).toBe(1280);
  expect(meta.calls.some((c) => c.client === 'image' && c.method === 'generate')).toBe(true);
});
