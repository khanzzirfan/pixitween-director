import sharp from 'sharp';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { addLayer, addScene, newFilmComposition, registerAsset } from '../authoring/api';
import { readDirector } from '../authoring/meta';
import type { Comp, Obj } from '../authoring/types';
import { LOCAL_EDIT_DENYLIST } from '../llm/router';
import { stripedCan } from '../product3d/test-images';
import { makeTestFilm } from '../test-utils/film';
import { allTools, runTool } from './registry';

const saved = { ...process.env };
beforeEach(() => {
  process.env.PRODUCT_3D = 'true';
});
afterEach(() => {
  process.env = { ...saved };
});

async function filmWithCan() {
  const t = await makeTestFilm();
  const { img } = stripedCan();
  const png = await sharp(Buffer.from(img.data.buffer), { raw: { width: img.width, height: img.height, channels: 4 } }).png().toBuffer();
  const cut = await t.assets.put(png, 'image/png', { role: 'cutout', width: img.width, height: img.height });
  let c: Comp = newFilmComposition({ aspect: '16:9', title: 'Can', palette: ['#111827'] });
  c = registerAsset(c, { id: cut.id, kind: 'image', src: cut.url, width: img.width, height: img.height });
  c = addScene(c, { id: 's1', durationSec: 4, mode: 'motion' });
  c = addLayer(c, { sceneId: 's1', role: 'bg', kind: 'shape', fill: '#111827' });
  c = addLayer(c, { sceneId: 's1', role: 'product', kind: 'image', assetId: cut.id, box: { x: 760, y: 200, w: 300, h: 500 } });
  c = addLayer(c, { sceneId: 's1', role: 'headline', kind: 'text', text: 'Slow mornings' });
  const r = await t.films.commit(t.filmId, c, 'director');
  expect(r.ok).toBe(true);
  return { ...t, cut };
}
const layers = async (t: Awaited<ReturnType<typeof filmWithCan>>) => ((((await t.films.get(t.filmId)).composition as Comp).precomps as Record<string, Obj>).s1!.layers as Obj[]);

it('lists the three tools only while PRODUCT_3D is on', () => {
  const names = () => allTools().map((x) => x.name);
  process.env.PRODUCT_3D = 'false';
  for (const n of ['placeProduct3D', 'turnProduct', 'lightProduct']) expect(names()).not.toContain(n);
  process.env.PRODUCT_3D = 'true';
  for (const n of ['placeProduct3D', 'turnProduct', 'lightProduct']) expect(names()).toContain(n);
  expect(new Set(names()).size).toBe(names().length);
});

it('keeps placeProduct3D away from the local model, and lets it turn and light', () => {
  expect(LOCAL_EDIT_DENYLIST).toContain('placeProduct3D');
  expect(LOCAL_EDIT_DENYLIST).not.toContain('turnProduct');
  expect(LOCAL_EDIT_DENYLIST).not.toContain('lightProduct');
});

it('placeProduct3D on a scene with a product cut-out commits one version containing s1:product3d', async () => {
  const t = await filmWithCan();
  const before = (await t.films.get(t.filmId)).version;
  const r = await runTool(t.ctx, 'placeProduct3D', { sceneId: 's1' });
  expect(r.ok, JSON.stringify(r)).toBe(true);
  expect((await t.films.get(t.filmId)).version).toBe(before + 1);
  const ls = await layers(t);
  expect(ls.map((l) => l.id)).toEqual(['s1:bg', 's1:product3d', 's1:headline']);
  const l = ls.find((x) => x.id === 's1:product3d')!;
  expect(l.source).toMatchObject({ type: 'primitive', shape: 'can' });
  expect(l.transform.position).toEqual([910, 450]); // the 2D product's centre
  // the label is a stored 'label' asset the layer points at
  const labelId = l.textures.label as string;
  expect((await t.assets.list()).find((a) => a.id === labelId)?.role).toBe('label');
  expect(t.events.some((e) => e.type === 'art.asset' && e.asset.role === 'label')).toBe(true);
});

it('uses the film product shape and an explicit shape over the default', async () => {
  const t = await filmWithCan();
  const r = await runTool(t.ctx, 'placeProduct3D', { sceneId: 's1', shape: 'box', preset: 'golden', sway: 25 });
  expect(r.ok, JSON.stringify(r)).toBe(true);
  const l = (await layers(t)).find((x) => x.id === 's1:product3d')!;
  expect(l.source).toMatchObject({ shape: 'box' });
  expect(l.textures.front).toBeDefined();
  expect(l.lighting.preset).toBe('golden');
  expect(l.view.rotation[0].v[1]).toBe(-25);
  expect(readDirector((await t.films.get(t.filmId)).composition as Comp).layers['s1:product3d']?.role).toBe('product3d');
});

it('refuses a scene with no product, an unknown scene and a generate scene, with a reason', async () => {
  const t = await makeTestFilm();
  let c = newFilmComposition({ aspect: '16:9', palette: ['#000000'] });
  c = addScene(c, { id: 's1', durationSec: 4, mode: 'motion' });
  c = addScene(c, { id: 's2', durationSec: 3, mode: 'generate' });
  await t.films.commit(t.filmId, c, 'director');
  expect(await runTool(t.ctx, 'placeProduct3D', { sceneId: 's1' })).toMatchObject({ ok: false, error: expect.stringContaining('placeProduct') });
  expect(await runTool(t.ctx, 'placeProduct3D', { sceneId: 'nope' })).toMatchObject({ ok: false, error: expect.stringContaining('nope') });
  expect(await runTool(t.ctx, 'placeProduct3D', { sceneId: 's2' })).toMatchObject({ ok: false, error: expect.stringContaining('generate') });
});

it('turnProduct and lightProduct change the placed layer in one version each', async () => {
  const t = await filmWithCan();
  await runTool(t.ctx, 'placeProduct3D', { sceneId: 's1' });
  const v = (await t.films.get(t.filmId)).version;
  const turned = await runTool(t.ctx, 'turnProduct', { sceneId: 's1', to: 50 });
  expect(turned).toMatchObject({ ok: true, data: { clamped: true, to: 35 } });
  const lit = await runTool(t.ctx, 'lightProduct', { sceneId: 's1', preset: 'window' });
  expect(lit.ok).toBe(true);
  expect((await t.films.get(t.filmId)).version).toBe(v + 2);
  const l = (await layers(t)).find((x) => x.id === 's1:product3d')!;
  expect(l.lighting.preset).toBe('window');
  expect(l.view.rotation.at(-1).v).toEqual([4, 35, 0]);
});

it('turnProduct on a scene without a model3d layer returns ok false naming the layer', async () => {
  const t = await filmWithCan();
  const r = await runTool(t.ctx, 'turnProduct', { sceneId: 's1', to: 10 });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error).toContain('s1:product3d');
  const l = await runTool(t.ctx, 'lightProduct', { sceneId: 's1', preset: 'night' });
  expect(l.ok).toBe(false);
});

it('rejects arguments outside the ranges before anything runs', async () => {
  const t = await filmWithCan();
  expect((await runTool(t.ctx, 'placeProduct3D', { sceneId: 's1', sway: 60 })).ok).toBe(false);
  expect((await runTool(t.ctx, 'lightProduct', { sceneId: 's1', preset: 'disco' })).ok).toBe(false);
});
