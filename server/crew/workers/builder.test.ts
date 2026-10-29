import { describe, expect, it } from 'vitest';
import type { Job } from '@shared/crew';
import type { LlmBackend, ToolCall } from '@shared/ports';
import type { Scene, Storyboard } from '@shared/storyboard';
import { addLayer, addScene, newFilmComposition, registerAsset } from '../../authoring/api';
import { sceneIds } from '../../authoring/meta';
import type { Comp, Obj } from '../../authoring/types';
import { makeTestCrew } from '../test-helpers';
import { restoreScene, snapshotScene } from '../scene-snapshot';
import { runBuilderJob } from './builder';

const scene: Scene = { id: 's1', durationSec: 4, intent: 'hero', shotType: 'hero', camera: 'static', layersWanted: ['bg', 'product'], mode: 'motion', modeReason: 'r' };
const storyboard: Storyboard = { title: 'T', aspect: '16:9', durationSec: 8, palette: ['#1f2937'], scenes: [scene, { ...scene, id: 's2' }] };
const ac = () => new AbortController().signal;

/** Answers each turn from `turns` and counts the calls. */
function scripted(turns: Array<Array<{ name: string; args: unknown }>>, id: LlmBackend['id'] = 'spark') {
  const queue = [...turns];
  let n = 0;
  const b: LlmBackend & { calls: () => number } = {
    id,
    calls: () => n,
    async chatWithTools() {
      const calls = queue.shift() ?? [];
      const t = n++;
      return { toolCalls: calls.map((c, i): ToolCall => ({ id: `c${t}_${i}`, name: c.name, args: c.args })), ms: 1 };
    },
  };
  return b;
}

async function setup(o: { layers?: number } = {}) {
  const t = await makeTestCrew();
  const product = (await t.film.films.get(t.film.filmId)).brief.productAssetId;
  let c = registerAsset(newFilmComposition({ aspect: '16:9', title: 'T', palette: ['#1f2937'] }), { id: product, kind: 'image', src: '/p.png', width: 64, height: 64 });
  c = addScene(addScene(c, { id: 's1', durationSec: 4, mode: 'motion' }), { id: 's2', durationSec: 4, mode: 'motion' });
  for (let i = 0; i < (o.layers ?? 0); i++) c = addLayer(c, { sceneId: 's1', role: 'caption', kind: 'text', text: `old ${i}` });
  await t.film.films.commit(t.film.filmId, c, 'director');
  await t.film.films.update(t.film.filmId, { storyboard });
  const job = (kind: Job['kind'], over: Partial<Job> = {}): Job => t.board.add({ kind, origin: 'showrunner', sceneId: 's1', brief: 'make it so', reason: 'r', ...over });
  const comp = async () => (await t.film.films.get(t.film.filmId)).composition as Comp;
  return { ...t, product, job, comp };
}
const layerIds = (c: Comp, scene = 's1') => ((c.precomps as Record<string, Obj>)[scene]!.layers as Obj[]).map((l) => l.id as string);
const caption = (n: number) => ({ name: 'addLayer', args: { sceneId: 's1', role: 'caption', kind: 'text', text: `new ${n}` } });

describe('runBuilderJob: build', () => {
  it('runs the scripted calls and reports them', async () => {
    const t = await setup();
    const b = scripted([[caption(1), caption(2), caption(3)]]);
    const job = t.job('build-scene');
    const r = await runBuilderJob(job, ac(), t.crew, { backendFor: () => b });
    expect(r.summary).toBe('3 tool calls, 3 ok');
    expect(layerIds(await t.comp())).toEqual(expect.arrayContaining(['s1:caption', 's1:caption-2', 's1:caption-3']));
    expect(r.version).toBeGreaterThan(1);
  });

  it('fills a missing background and product with defaults, as the sequential director does', async () => {
    const t = await setup();
    await runBuilderJob(t.job('build-scene'), ac(), t.crew, { backendFor: () => scripted([[caption(1)]]) });
    expect(layerIds(await t.comp())).toEqual(expect.arrayContaining(['s1:bg', 's1:product']));
  });

  it('puts the style bible and the job brief in the prompt', async () => {
    const t = await setup();
    await t.film.films.update(t.film.filmId, { styleBible: { palette: ['#1f2937', '#f59e0b'], light: 'warm sun', camera: 'slow', type: { font: 'Inter', weight: 800, case: 'upper' }, productLine: 'a can', mood: 'calm' } });
    let system = '';
    const spy: LlmBackend = { id: 'spark', async chatWithTools(m) { system = String(m[0]!.content); return { toolCalls: [], ms: 1 }; } };
    await runBuilderJob(t.job('build-scene', { brief: 'Warmer light please' }), ac(), t.crew, { backendFor: () => spy }).catch(() => undefined);
    expect(system).toContain('STYLE BIBLE');
    expect(system).toContain('palette: #1f2937 #f59e0b');
    expect(system).toContain('YOUR JOB (j1, build-scene, scene s1)');
    expect(system).toContain('Warmer light please');
  });

  it('rejects a call on another scene with the scope message, and the model sees it', async () => {
    const t = await setup();
    const seen: string[] = [];
    let turn = 0;
    const b: LlmBackend = {
      id: 'spark',
      async chatWithTools(m) {
        seen.push(JSON.stringify(m.at(-1)));
        return turn++ === 0 ? { toolCalls: [{ id: 'x', name: 'addLayer', args: { sceneId: 's2', role: 'caption', kind: 'text', text: 'oops' } }], ms: 1 } : { toolCalls: [], ms: 1 };
      },
    };
    await runBuilderJob(t.job('build-scene'), ac(), t.crew, { backendFor: () => b }).catch(() => undefined);
    expect(seen[1]).toContain('out of scope: this job owns scene s1 only');
    expect(layerIds(await t.comp(), 's2')).toEqual([]);
  });

  it('fails the job when the model makes no calls at all', async () => {
    const t = await setup();
    await expect(runBuilderJob(t.job('build-scene'), ac(), t.crew, { backendFor: () => scripted([]) })).rejects.toThrow(/no progress/);
  });

  it('an unknown scene and a job with no scene are errors', async () => {
    const t = await setup();
    await expect(runBuilderJob(t.job('build-scene', { sceneId: 's9' }), ac(), t.crew, { backendFor: () => scripted([]) })).rejects.toThrow(/unknown scene s9/);
    await expect(runBuilderJob(t.job('build-scene', { sceneId: undefined }), ac(), t.crew, { backendFor: () => scripted([]) })).rejects.toThrow(/needs a scene/);
  });

  it('stops with an AbortError when the signal is aborted, and writes nothing', async () => {
    const t = await setup();
    const controller = new AbortController();
    controller.abort();
    await expect(runBuilderJob(t.job('build-scene'), controller.signal, t.crew, { backendFor: () => scripted([[caption(1)]]) })).rejects.toMatchObject({ name: 'AbortError' });
    expect(layerIds(await t.comp())).toEqual([]);
  });
});

describe('runBuilderJob: rebuild, restyle, edit, fix', () => {
  it('a rebuild on a scene with 4 layers leaves only what the model adds', async () => {
    const t = await setup({ layers: 4 });
    expect(layerIds(await t.comp())).toHaveLength(4);
    const add = [
      { name: 'addLayer', args: { sceneId: 's1', role: 'bg', kind: 'shape', fill: '#112233' } },
      { name: 'addLayer', args: { sceneId: 's1', role: 'product', kind: 'image', assetId: t.product } },
    ];
    await runBuilderJob(t.job('rebuild-scene'), ac(), t.crew, { backendFor: () => scripted([add]) });
    expect(layerIds(await t.comp())).toEqual(['s1:bg', 's1:product']);
    expect(layerIds(await t.comp(), 's2')).toEqual([]);
  });

  it('a restyle keeps the existing layers and lets the model use the edit-only tools', async () => {
    const t = await setup({ layers: 2 });
    const before = layerIds(await t.comp());
    let offered: string[] = [];
    let turn = 0;
    const b: LlmBackend = { id: 'spark', async chatWithTools(_m, tools) { offered = tools.map((x) => x.name); return { toolCalls: turn++ ? [] : [{ id: 'a', name: 'removeLayer', args: { layerId: before[0] } }], ms: 1 }; } };
    const r = await runBuilderJob(t.job('restyle-scene'), ac(), t.crew, { backendFor: () => b });
    expect(offered).toContain('removeLayer');
    expect(r.summary).toContain('1 tool calls, 1 ok');
    expect(layerIds(await t.comp())).toEqual([before[1]]);
  });

  it('edit and fix commit as a chat edit, and build as the director', async () => {
    const t = await setup({ layers: 1 });
    await runBuilderJob(t.job('fix'), ac(), t.crew, { backendFor: () => scripted([[{ name: 'setText', args: { layerId: 's1:caption', text: 'fixed' } }]]) });
    await runBuilderJob(t.job('build-scene'), ac(), t.crew, { backendFor: () => scripted([[caption(9)]]) });
    const versions = await t.film.films.versions(t.film.filmId);
    expect(versions.map((v) => v.source)).toContain('chat'); // the fix
    expect(versions.filter((v) => v.source === 'chat')).toHaveLength(1);
    expect(versions.at(-1)!.source).toBe('director'); // the build and its defaults
  });

  it('reports the cost of the job from the ledger', async () => {
    const t = await setup();
    const b: LlmBackend = {
      id: 'spark',
      async chatWithTools() {
        t.crew.toolCtx.ledger.add(t.film.filmId, 'muse-spark-1.3-contributor', 'x', 0.012);
        return { toolCalls: [], ms: 1 };
      },
    };
    await expect(runBuilderJob(t.job('edit'), ac(), t.crew, { backendFor: () => b })).rejects.toThrow(); // no calls: a stall, but the spend is real
    expect(t.crew.toolCtx.ledger.total(t.film.filmId)).toBeCloseTo(0.012);
  });
});

describe('runBuilderJob: revert', () => {
  it('restores the snapshot of the last done job with no model call', async () => {
    const t = await setup({ layers: 2 });
    const before = await t.comp();
    const snap = snapshotScene(before, 's1');
    // a done build whose snapshot is the scene before it ran, then more edits on top
    const done = t.board.add({ kind: 'build-scene', origin: 'auto', sceneId: 's1' });
    t.board.update(done.id, { status: 'running' });
    t.board.update(done.id, { status: 'done' });
    await t.film.films.mutate(t.film.filmId, (f) => ({ next: addLayer(f.composition as Comp, { sceneId: 's1', role: 'headline', kind: 'text', text: 'later' }), data: null }), 'director');
    expect(layerIds(await t.comp())).toHaveLength(3);
    t.crew.snapshots = { load: async (id) => (id === done.id ? snap : undefined) };
    const b = scripted([]);
    const r = await runBuilderJob(t.job('revert'), ac(), t.crew, { backendFor: () => b });
    expect(b.calls()).toBe(0);
    expect(r.summary).toContain(`before ${done.id}`);
    expect(layerIds(await t.comp())).toEqual(layerIds(before));
    expect(sceneIds(await t.comp())).toEqual(['s1', 's2']);
    void restoreScene;
  });

  it('fails when there is nothing to go back to', async () => {
    const t = await setup();
    await expect(runBuilderJob(t.job('revert'), ac(), t.crew)).rejects.toThrow('nothing to revert to');
  });
});
