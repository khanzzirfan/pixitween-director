import { Buffer } from 'node:buffer';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { addLayer, addScene, newFilmComposition, registerAsset } from '../authoring/api';
import { makeTestFilm } from '../test-utils/film';
import { imageSize } from '../media/image';
import { runTool } from '../tools/registry';
import { cutout, ownAlpha, selectObject, studioKey } from './cutout';
import { lintPrompt, extractBrandTerms } from './lint';
import { coverCrop } from './stills';
import type { SamObject } from '@shared/ports';

it('lints brands and named people but allows generic apple references', () => {
  expect(lintPrompt('A Nike shoe on a table').violations).toContainEqual({ rule: 'brand-name', term: 'nike' });
  expect(lintPrompt('warm oak counter at sunrise. No people.').ok).toBe(true);
  expect(lintPrompt('an apple orchard at dawn').ok).toBe(true);
  expect(extractBrandTerms("it's our new cold brew from Coffee Co. I want a mug")).toEqual(['Coffee Co']);
  expect(lintPrompt('Portrait of Tom Hanks', { subject: true }).violations).toContainEqual({ rule: 'named-person', term: 'Tom Hanks' });
});

it('covers the target aspect without enlarging an already larger image', async () => {
  const png = await sharp({ create: { width: 400, height: 300, channels: 3, background: '#336699' } })
    .png()
    .toBuffer();
  const crop = await coverCrop(png, '16:9');
  expect(await imageSize(crop)).toMatchObject({ width: 1920, height: 1080 });
  const portrait = await coverCrop(png, '9:16');
  expect(await imageSize(portrait)).toMatchObject({ width: 720, height: 1280 });
});

it('chooses the highest-area eligible SAM object, then confidence on ties', () => {
  const object = (objectId: string, confidence: number, bounds: SamObject['bounds']): SamObject => ({
    objectId,
    confidence,
    bounds,
    alpha: Buffer.alloc(1),
  });
  expect(
    selectObject([
      object('large-low', 0.4, { left: 0, top: 0, right: 100, bottom: 100 }),
      object('small-high', 0.9, { left: 0, top: 0, right: 10, bottom: 10 }),
    ])?.objectId,
  ).toBe('small-high');
  expect(
    selectObject([
      object('a', 0.7, { left: 0, top: 0, right: 10, bottom: 10 }),
      object('b', 0.9, { left: 0, top: 0, right: 10, bottom: 10 }),
    ])?.objectId,
  ).toBe('b');
  expect(selectObject([object('low', 0.1, { left: 0, top: 0, right: 10, bottom: 10 })])).toBeUndefined();
});

it('keys a product on a white studio background without calling SAM', async () => {
  const t = await makeTestFilm();
  const source = await sharp({ create: { width: 80, height: 80, channels: 3, background: '#ffffff' } })
    .composite([{ input: await sharp({ create: { width: 30, height: 16, channels: 3, background: '#111111' } }).png().toBuffer(), left: 20, top: 32 }])
    .png()
    .toBuffer();
  const keyed = await studioKey(source);
  expect(keyed?.objectId).toBe('studio-key');
  const cut = await cutout(t.ctx, { source, noun: 'shoe', sceneId: 's1' });
  expect(t.meta.calls.filter((call) => call.client === 'sam')).toHaveLength(0);
  expect(t.ledger.total(t.filmId)).toBe(0);
  expect(cut.cutout.width).toBeLessThan(80);
  expect(cut.objectId).toBe('studio-key');
});

it('keeps a light product on a white sweep whole: only backdrop joined to the edge is keyed', async () => {
  // a cream can with a dark band: the cream is close to the backdrop, but it is inside the outline
  const can = await sharp({ create: { width: 30, height: 60, channels: 3, background: '#f2ece0' } })
    .composite([{ input: await sharp({ create: { width: 30, height: 12, channels: 3, background: '#3b2113' } }).png().toBuffer(), left: 0, top: 30 }])
    .png()
    .toBuffer();
  const outline = await sharp({ create: { width: 34, height: 64, channels: 3, background: '#555555' } }).composite([{ input: can, left: 2, top: 2 }]).png().toBuffer();
  const source = await sharp({ create: { width: 100, height: 100, channels: 3, background: '#ffffff' } }).composite([{ input: outline, left: 33, top: 18 }]).png().toBuffer();
  const keyed = await studioKey(source);
  const inside = keyed!.alpha[(18 + 10) * 100 + 50]!;
  expect(inside).toBe(255);
  expect(keyed!.alpha[5 * 100 + 5]).toBe(0);
});

it('uses the photo\'s own clear background as the mask, with no SAM call', async () => {
  const t = await makeTestFilm();
  const source = await sharp({ create: { width: 60, height: 60, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 0 } } })
    .composite([{ input: await sharp({ create: { width: 20, height: 40, channels: 4, background: { r: 240, g: 232, b: 218, alpha: 1 } } }).png().toBuffer(), left: 20, top: 10 }])
    .png()
    .toBuffer();
  const own = await ownAlpha(source);
  expect(own?.bounds).toEqual({ left: 20, top: 10, right: 40, bottom: 50 });
  const cut = await cutout(t.ctx, { source, noun: 'can', sceneId: 's1' });
  expect(cut.objectId).toBe('own-alpha');
  expect(t.meta.calls.filter((call) => call.client === 'sam')).toHaveLength(0);
  // a photo with no clear edge is not taken as cut out
  expect(await ownAlpha(await sharp({ create: { width: 20, height: 20, channels: 4, background: { r: 9, g: 9, b: 9, alpha: 1 } } }).png().toBuffer())).toBeUndefined();
});

describe('SAM cutout and placeProduct tool', () => {
  it('asks once more for "product", less strictly, when SAM finds nothing by the name asked for', async () => {
    const t = await makeTestFilm();
    const source = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#777777' } }).png().toBuffer();
    const real = t.meta.sam.segmentImage;
    const asked: string[] = [];
    t.meta.sam.segmentImage = async (img: Buffer, noun: string) => {
      asked.push(noun);
      const found = await real(img, noun);
      return noun === 'longboard' ? [] : found.map((o) => ({ ...o, confidence: 0.4 }));
    };
    const cut = await cutout(t.ctx, { source, noun: 'longboard', sceneId: 's1' });
    expect(asked).toEqual(['longboard', 'product']);
    expect(cut.cutout.width).toBeGreaterThan(0);
    expect(t.ledger.total(t.filmId)).toBeCloseTo(0.005);
  });
  it('tries the other words in order, and keeps a find just under the bar when no word clears it', async () => {
    const t = await makeTestFilm();
    const source = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#777777' } }).png().toBuffer();
    const real = t.meta.sam.segmentImage;
    const asked: string[] = [];
    t.meta.sam.segmentImage = async (img: Buffer, noun: string) => {
      asked.push(noun);
      const found = await real(img, noun);
      return noun === 'goggles' ? found.map((o) => ({ ...o, confidence: 0.92 })) : noun === 'swim' ? found.map((o) => ({ ...o, confidence: 0.42 })) : [];
    };
    await cutout(t.ctx, { source, noun: 'water', alsoTry: ['goggles', 'swim'], sceneId: 's1' });
    expect(asked).toEqual(['water', 'goggles']);
    asked.length = 0;
    await cutout(t.ctx, { source, noun: 'water', alsoTry: ['swim', 'lens'], sceneId: 's1' });
    // no word cleared 0.5, but "swim" found something at 0.42: it is used, and the general word is not asked
    expect(asked).toEqual(['water', 'swim', 'lens']);
  });
  it('caches cutouts by key and records one SAM charge', async () => {
    const t = await makeTestFilm();
    const source = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#777777' } })
      .png()
      .toBuffer();
    const first = await cutout(t.ctx, { source, noun: 'mug', sceneId: 's1', cacheKey: 'cache-cutout-test' });
    const second = await cutout(t.ctx, { source, noun: 'mug', sceneId: 's1', cacheKey: 'cache-cutout-test' });
    expect(second).toEqual(first);
    expect(t.meta.calls.filter((call) => call.client === 'sam')).toHaveLength(1);
    expect(t.ledger.total(t.filmId)).toBeCloseTo(0.0025);
  });

  it('commits a cut-out product layer for a motion scene', async () => {
    const t = await makeTestFilm();
    const film = await t.films.get(t.filmId);
    const product = film.assets[0]!;
    let comp = newFilmComposition({ aspect: film.aspect, title: 'Test', palette: ['#111827'] });
    comp = registerAsset(comp, { id: product.id, kind: 'image', src: product.url, width: product.width, height: product.height });
    comp = addScene(comp, { id: 's1', durationSec: 4, mode: 'motion', intent: 'product hero' });
    comp = addLayer(comp, { sceneId: 's1', role: 'bg', kind: 'shape', fill: '#111827' });
    await t.films.commit(t.filmId, comp, 'director');
    const result = await runTool(t.ctx, 'placeProduct', { sceneId: 's1', noun: 'mug' });
    expect(result.ok).toBe(true);
    const stored = await t.films.get(t.filmId);
    expect(stored.version).toBe(2);
    const layer = stored.composition?.precomps?.s1?.layers.find((candidate) => candidate.id === 's1:product');
    expect(layer?.kind).toBe('image');
    const assetId = (layer as { assetId?: string }).assetId!;
    expect(stored.composition?.assets[assetId]).toBeDefined();
    expect(stored.composition?.precomps?.s1?.assets[assetId]).toBeDefined();
  });
});
