import sharp from 'sharp';
import { expect, it } from 'vitest';
import { addLayer, addScene, newFilmComposition, registerAsset, setTransform } from '../authoring/api';
import { makeFakeMeta } from '../meta/fakes';
import { makeTestFilm } from '../test-utils/film';
import { storeFrames } from '../review/frames';
import { allTools, runTool } from './registry';
import { reviewRules } from './review';
import type { AepCompositionJson } from 'reacthub-pixitweenjs';

const png = (c = '#808080') =>
  // a mark on the picture: a frame of one flat colour counts as blank and is skipped by the review
  sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="${c}"/><rect x="4" y="4" width="12" height="12" fill="#ffffff"/></svg>`))
    .png()
    .toBuffer();

async function captionFilm(captionY: number, reviewScript: unknown[] = []) {
  const t = await makeTestFilm();
  const asset = await t.assets.put(await png('#334455'), 'image/png', { role: 'product-photo' });
  let comp = newFilmComposition({ aspect: '16:9', title: 'T', palette: ['#111827'] });
  comp = registerAsset(comp, { id: asset.id, kind: 'image', src: asset.url, width: 64, height: 64 });
  comp = addScene(comp, { id: 's1', durationSec: 4, mode: 'motion', intent: 'hero' });
  comp = addLayer(comp, { sceneId: 's1', role: 'bg', kind: 'shape', fill: '#111827' });
  comp = addLayer(comp, { sceneId: 's1', role: 'product', kind: 'image', assetId: asset.id, box: { x: 560, y: 140, w: 800, h: 800 } });
  comp = addLayer(comp, { sceneId: 's1', role: 'caption', kind: 'text', text: 'Slow mornings', box: { x: 700, y: 400, w: 520, h: 120 } });
  comp = setTransform(comp, 's1:caption', { y: captionY });
  await t.films.commit(t.filmId, comp, 'director');
  const meta = makeFakeMeta({ reviewScript });
  return { ...t, meta, ctx: { ...t.ctx, meta } };
}

it('reviewScene asks for captured frames first and makes no Spark call', async () => {
  const t = await captionFilm(800);
  const out = await runTool(t.ctx, 'reviewScene', { sceneId: 's1' });
  expect(out).toEqual({ ok: false, error: 'capture frames first' });
  expect(t.meta.calls.filter((c) => c.client === 'spark')).toHaveLength(0);
});

it('reviewScene reviews with the newest captured frames and fixes the caption', async () => {
  const t = await captionFilm(800, [{ sceneId: 's1', pass: true, issues: [], fixes: [] }]);
  await storeFrames(t.assets, t.filmId, [{ bytes: await png(), mime: 'image/png', meta: { sceneId: 's1', atSec: 0.8 } }], {
    phase: 'before',
    batch: '2026-01-01T00:00:00Z',
  });
  await storeFrames(t.assets, t.filmId, [{ bytes: await png(), mime: 'image/png', meta: { sceneId: 's1', atSec: 2 } }], {
    phase: 'before',
    batch: '2026-01-02T00:00:00Z',
  });
  const out = await runTool(t.ctx, 'reviewScene', { sceneId: 's1' });
  expect(out.ok).toBe(true);
  expect(t.meta.calls.filter((c) => c.client === 'spark' && c.method === 'reviewImages')).toHaveLength(1);
  const comp = (await t.films.get(t.filmId)).composition as AepCompositionJson;
  const caption = (comp.precomps!.s1 as { layers: Array<{ id: string; transform: { position: [number, number] } }> }).layers.find(
    (l) => l.id === 's1:caption',
  )!;
  expect(caption.transform.position[1]).not.toBe(800);
});

it('reviewDeterministic is listed and makes no Spark call', async () => {
  const t = await captionFilm(800);
  const out = await runTool(t.ctx, 'reviewDeterministic', { sceneIds: ['s9'] });
  expect(out).toMatchObject({ ok: true, data: { findings: [], skipped: [{ sceneId: 's9', reason: 'unknown scene' }] } });
  expect(reviewRules.name).toBe('reviewDeterministic');
  expect(t.meta.calls.filter((c) => c.client === 'spark')).toHaveLength(0);
});

it('registers reviewScene exactly once', () => {
  expect(allTools().filter((x) => x.name === 'reviewScene')).toHaveLength(1);
});

it('both review tools answer ok:false on a film with no composition', async () => {
  const t = await makeTestFilm();
  expect(await runTool(t.ctx, 'reviewScene', { sceneId: 's1' })).toEqual({ ok: false, error: 'film has no composition yet' });
  expect(await runTool(t.ctx, 'reviewDeterministic', {})).toEqual({ ok: false, error: 'film has no composition yet' });
});
