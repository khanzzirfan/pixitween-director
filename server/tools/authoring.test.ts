import { describe, expect, it } from 'vitest';
import { newFilmComposition, registerAsset } from '../authoring/api';
import { lightValidate } from '../engine/light-validator';
import { readSeedJson } from '../test-utils/fixtures';
import { makeTestFilm } from '../test-utils/film';
import { runTool } from './registry';
import { tools } from './authoring';

const MUG = 'ast_0123456789abcdef0123456789abcdef';

async function setup() {
  const t = await makeTestFilm();
  return { t, call: (name: string, args: unknown) => runTool(t.ctx, name, args), comp: async () => (await t.films.get(t.filmId)).composition! };
}
async function withMug() {
  const s = await setup();
  const base = registerAsset(newFilmComposition({ aspect: '16:9', title: 'T', palette: ['#111827'] }), { id: MUG, kind: 'image', src: `/api/assets/${MUG}`, width: 384, height: 672 });
  await s.t.films.commit(s.t.filmId, base, 'director');
  return s;
}

describe('scene tools', () => {
  it('addScene creates the composition on first use', async () => {
    const { call, comp, t } = await setup();
    expect(await call('addScene', { id: 's1', durationSec: 4 })).toEqual({ ok: true, version: 1, data: { sceneId: 's1', startSec: 0 } });
    expect(await call('addScene', { id: 's2', durationSec: 3 })).toMatchObject({ ok: true, version: 2, data: { sceneId: 's2', startSec: 4 } });
    expect(Object.keys((await comp()).precomps!)).toEqual(['s1', 's2']);
    expect((await t.films.get(t.filmId)).version).toBe(2);
  });
  it('a duplicate id fails and leaves the version alone', async () => {
    const { call, t } = await setup();
    await call('addScene', { id: 's1', durationSec: 4 });
    const r = await call('addScene', { id: 's1', durationSec: 4 });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.startsWith('duplicate_scene')).toBe(true);
    expect((await t.films.get(t.filmId)).version).toBe(1);
  });
  it('swap, remove and retime change the stored film', async () => {
    const { call, comp } = await setup();
    await call('addScene', { id: 's1', durationSec: 4 });
    await call('addScene', { id: 's2', durationSec: 3 });
    await call('swapScenes', { a: 's1', b: 's2' });
    expect((await comp()).layers.map((l) => l.id)).toEqual(['s2', 's1']);
    await call('setSceneDuration', { sceneId: 's1', durationSec: 2 });
    expect((await comp()).durationInFrames).toBe(150);
    await call('removeScene', { sceneId: 's2' });
    expect((await comp()).layers.map((l) => l.id)).toEqual(['s1']);
  });
  it('keeps descriptions short', () => {
    for (const t of tools) expect(t.description.length, t.name).toBeLessThanOrEqual(160);
  });
  it('concurrent tool calls on one film both persist', async () => {
    const { call, comp, t } = await withMug();
    await Promise.all([call('addScene', { id: 's1', durationSec: 4 }), call('addScene', { id: 's2', durationSec: 4 })]);
    const before = (await t.films.get(t.filmId)).version;
    const [a, b] = await Promise.all([
      call('addLayer', { sceneId: 's1', role: 'bg', kind: 'shape' }),
      call('addLayer', { sceneId: 's2', role: 'bg', kind: 'shape' }),
    ]);
    expect(a.ok && b.ok).toBe(true);
    const c = await comp();
    expect((c.precomps as Record<string, { layers: unknown[] }>).s1!.layers).toHaveLength(1);
    expect((c.precomps as Record<string, { layers: unknown[] }>).s2!.layers).toHaveLength(1);
    expect((await t.films.get(t.filmId)).version).toBe(before + 2);
  });
});

describe('layer tools', () => {
  it('allocates ids, ignores a stray layerId and suggests the full id', async () => {
    const { call, comp } = await withMug();
    await call('addScene', { id: 's1', durationSec: 4 });
    expect(await call('addLayer', { sceneId: 's1', role: 'bg', kind: 'shape' })).toMatchObject({ ok: true, data: { layerId: 's1:bg' } });
    expect(await call('addLayer', { sceneId: 's1', role: 'bg', kind: 'shape', layerId: 'x' })).toMatchObject({ ok: true, data: { layerId: 's1:bg-2' } });
    expect(await call('addLayer', { sceneId: 's1', role: 'product', kind: 'image', assetId: MUG })).toMatchObject({ ok: true, data: { layerId: 's1:product' } });
    await call('addLayer', { sceneId: 's1', role: 'headline', kind: 'text', text: 'Hi' });
    const r = await call('setText', { layerId: 'headline', text: 'x' });
    expect(!r.ok && r.error).toContain('Did you mean s1:headline?');
    expect(await call('reorderLayer', { layerId: 's1:headline', to: { below: 's1:product' } })).toMatchObject({ ok: true });
    await call('setText', { layerId: 's1:headline', text: 'Fresh words' });
    const layers = ((await comp()).precomps as Record<string, { layers: Array<{ id: string; source?: string }> }>).s1!.layers;
    expect(layers.find((l) => l.id === 's1:headline')!.source).toBe('Fresh words');
  });
  it('rejects setTransform with no properties', async () => {
    const { call } = await withMug();
    await call('addScene', { id: 's1', durationSec: 4 });
    const r = await call('setTransform', { layerId: 's1:bg' });
    expect(r.ok).toBe(false);
    expect(!r.ok && (r.zodIssues as unknown[]).length > 0).toBe(true);
  });
});

describe('scripted scene', () => {
  it('runs the six seed-shaped calls and a camera', async () => {
    const { call, comp, t } = await withMug();
    void readSeedJson('spark-tool-loop-turns.json');
    const calls: Array<[string, unknown]> = [
      ['addScene', { id: 's1', durationSec: 4, intent: 'white ceramic mug warm morning scene' }],
      ['addLayer', { sceneId: 's1', role: 'bg', kind: 'shape', fill: '#111827' }],
      ['addLayer', { sceneId: 's1', role: 'product', kind: 'image', assetId: MUG }],
      ['addLayer', { sceneId: 's1', role: 'headline', kind: 'text', text: 'Slow mornings' }],
      ['setKeyframes', { layerId: 's1:headline', prop: 'opacity', keys: [[1, 0], [2, 1]], ease: 'easeOut' }],
      ['setKeyframes', { layerId: 's1:product', prop: 'scale', keys: [[0, 0.9], [4, 1]], ease: 'easeInOut' }],
    ];
    for (const [name, args] of calls) expect((await call(name, args)).ok, name).toBe(true);
    const f = await t.films.get(t.filmId);
    expect(f.version).toBe(7); // the registered mug asset is version 1
    expect(lightValidate(f.composition).ok).toBe(true);
    expect(await call('setCamera', { sceneId: 's1', move: 'dolly-in' })).toMatchObject({ ok: true });
    const product = ((await comp()).precomps as Record<string, { layers: Array<{ id: string; transform: { position: unknown } }> }>).s1!.layers.find((l) => l.id === 's1:product')!;
    expect(Array.isArray(product.transform.position) && typeof (product.transform.position as unknown[])[0] === 'object').toBe(true);
  });
});
