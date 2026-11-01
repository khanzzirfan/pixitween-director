import { Hono } from 'hono';
import sharp from 'sharp';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { addLayer, addScene, newFilmComposition, registerAsset } from '../../authoring/api';
import type { Comp, Obj } from '../../authoring/types';
import { stripedCan } from '../../product3d/test-images';
import { makeTestFilm } from '../../test-utils/film';
import { getTool } from '../../tools/registry';
import type { AppDeps } from '../deps';
import { registerGenerateRoutes } from './generate';

const saved = { ...process.env };
beforeEach(() => {
  process.env.PRODUCT_3D = 'true';
});
afterEach(() => {
  process.env = { ...saved };
});

async function setup() {
  const t = await makeTestFilm();
  const { img } = stripedCan();
  const png = await sharp(Buffer.from(img.data.buffer), { raw: { width: img.width, height: img.height, channels: 4 } }).png().toBuffer();
  const cut = await t.assets.put(png, 'image/png', { role: 'cutout', width: img.width, height: img.height });
  let c: Comp = newFilmComposition({ aspect: '16:9', title: 'Can', palette: ['#111827'] });
  c = registerAsset(c, { id: cut.id, kind: 'image', src: cut.url, width: img.width, height: img.height });
  for (const id of ['s1', 's2']) {
    c = addScene(c, { id, durationSec: 4, mode: 'motion' });
    c = addLayer(c, { sceneId: id, role: 'bg', kind: 'shape', fill: '#111827' });
    c = addLayer(c, { sceneId: id, role: 'product', kind: 'image', assetId: cut.id, box: { x: 760, y: 200, w: 300, h: 500 } });
    c = addLayer(c, { sceneId: id, role: 'headline', kind: 'text', text: 'Slow mornings' });
  }
  expect((await t.films.commit(t.filmId, c, 'director')).ok).toBe(true);
  await t.films.update(t.filmId, {
    storyboard: {
      title: 'Can', aspect: '16:9', durationSec: 8, palette: ['#111827'], productShape: 'can',
      scenes: ['s1', 's2'].map((id) => ({ id, durationSec: 4, intent: 'x', shotType: 'hero', camera: 'static', layersWanted: ['bg', 'product'], mode: 'motion', modeReason: 'stills' })),
    } as never,
  });
  const deps = { films: t.films, assets: t.assets, meta: t.meta, ledger: t.ledger, bus: t.bus, makeToolCtx: () => t.ctx } as AppDeps;
  const app = new Hono();
  registerGenerateRoutes(app, deps);
  const mode = (sceneId: string, m: string) =>
    app.request(`/api/films/${t.filmId}/scenes/${sceneId}/mode`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: m }) });
  const layers = async (sceneId = 's1') => (((await t.films.get(t.filmId)).composition as Comp).precomps as Record<string, Obj>)[sceneId]!.layers as Obj[];
  return { t, mode, layers };
}

it("switching to '3d' returns 200, makes no Meta call and leaves s1:product3d in the composition", async () => {
  const s = await setup();
  expect(getTool('placeProduct3D')).toBeDefined();
  const res = await s.mode('s1', '3d');
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ mode: '3d' });
  expect((await s.layers()).map((l) => l.id)).toEqual(['s1:bg', 's1:product3d', 's1:headline']);
  expect(s.t.meta.calls).toHaveLength(0);
  expect((await s.t.films.get(s.t.filmId)).storyboard?.scenes[0]).toMatchObject({ id: 's1', mode: '3d' });
  expect((await s.t.films.get(s.t.filmId)).storyboard?.scenes[1]).toMatchObject({ id: 's2', mode: 'motion' });
  const versions = await s.t.films.versions(s.t.filmId);
  expect(versions.at(-1)?.source).toBe('user');
});

it("switching back to 'motion' restores s1:product with a transform deep-equal to the original", async () => {
  const s = await setup();
  const original = (await s.layers()).find((l) => l.id === 's1:product')!;
  await s.mode('s1', '3d');
  const back = await s.mode('s1', 'motion');
  expect(back.status).toBe(200);
  const now = await s.layers();
  expect(now.map((l) => l.id)).toEqual(['s1:bg', 's1:product', 's1:headline']);
  expect(now.find((l) => l.id === 's1:product')).toEqual(original);
  expect((await s.t.films.get(s.t.filmId)).storyboard?.scenes[0]!.mode).toBe('motion');
  expect(JSON.stringify((await s.t.films.get(s.t.filmId)).composition)).not.toContain('product3d');
});

it("with PRODUCT_3D off, '3d' is refused with 400 3d_disabled and nothing changes", async () => {
  const s = await setup();
  process.env.PRODUCT_3D = 'false';
  const v = (await s.t.films.get(s.t.filmId)).version;
  const res = await s.mode('s1', '3d');
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: '3d_disabled' });
  expect((await s.t.films.get(s.t.filmId)).version).toBe(v);
});

it('asking for 3d twice is the same as once, and a 404 for a scene that is not there', async () => {
  const s = await setup();
  await s.mode('s1', '3d');
  const v = (await s.t.films.get(s.t.filmId)).version;
  expect((await s.mode('s1', '3d')).status).toBe(200);
  expect((await s.t.films.get(s.t.filmId)).version).toBe(v);
  expect((await s.mode('nope', '3d')).status).toBe(404);
});

it('says why when a scene has no product to turn', async () => {
  const s = await setup();
  const c = structuredClone((await s.t.films.get(s.t.filmId)).composition as Comp);
  const inner = (c.precomps as Record<string, Obj>).s2!;
  inner.layers = (inner.layers as Obj[]).filter((l) => l.id !== 's2:product');
  delete (c.meta as { director: { layers: Record<string, unknown> } }).director.layers['s2:product'];
  await s.t.films.commit(s.t.filmId, c, 'director');
  const res = await s.mode('s2', '3d');
  expect(res.status).toBe(422);
  expect(await res.json()).toMatchObject({ error: 'cannot_place' });
});
