import { Buffer } from 'node:buffer';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { addLayer, addScene, newFilmComposition, registerAsset } from '../authoring/api';
import { makeTestFilm } from '../test-utils/film';
import { imageSize } from '../media/image';
import { runTool } from '../tools/registry';
import { cutout, selectObject } from './cutout';
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

describe('SAM cutout and placeProduct tool', () => {
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
