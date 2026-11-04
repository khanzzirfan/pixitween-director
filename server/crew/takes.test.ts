import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import type { Job } from '@shared/crew';
import type { Scene } from '@shared/storyboard';
import { addLayer, addScene, newFilmComposition, registerAsset } from '../authoring/api';
import type { Comp, Obj } from '../authoring/types';
import { createApp } from '../http/app';
import { makeToolCtx } from '../http/deps';
import { makeTestDeps } from '../test-utils/deps';
import { TAKE_HINTS, createTakes, scoreOf, type TakesOptions } from './takes';
import { makeTestCrew } from './test-helpers';

const scene = (id: string): Scene => ({ id, durationSec: 4, intent: 'hero', shotType: 'hero', camera: 'static', layersWanted: ['bg', 'product'], mode: 'motion', modeReason: 'r' });
const precomp = (c: Comp, id: string) => (c.precomps as Record<string, Obj>)[id]!;
const ac = () => new AbortController().signal;

async function setup() {
  const t = await makeTestCrew();
  const f = await t.film.films.get(t.film.filmId);
  const product = f.brief.productAssetId;
  let c = registerAsset(newFilmComposition({ aspect: '16:9', title: 'T', palette: ['#111111'] }), { id: product, kind: 'image', src: '/p.png', width: 64, height: 64 });
  for (const id of ['s1', 's2']) {
    c = addScene(c, { id, durationSec: 4, mode: 'motion' });
    c = addLayer(c, { sceneId: id, role: 'product', kind: 'image', assetId: product, box: { x: 600, y: 200, w: 400, h: 400 } });
  }
  await t.film.films.commit(t.film.filmId, c, 'director');
  await t.film.films.update(t.film.filmId, { title: 'Mug film', status: 'ready', storyboard: { title: 'T', aspect: '16:9', durationSec: 8, palette: ['#111111'], scenes: [scene('s1'), scene('s2')] } });
  const seen: Job[] = [];
  /** A builder that records its job and adds one caption layer to the scene in the film the job names. */
  const builder: NonNullable<TakesOptions['builder']> = async (job, _signal, crew) => {
    seen.push(job);
    await crew.films.mutate(job.filmId, (x) => ({ next: addLayer(x.composition as Comp, { sceneId: job.sceneId!, role: 'caption', kind: 'text', text: `take ${job.takeLabel}` }), data: null }), 'director');
    return { summary: 'built', costUsd: 0.03, version: 9 };
  };
  const takes = createTakes({ builder, findings: async () => ({ rules: 0, critic: 0 }) });
  const job = (label: 'A' | 'B' | 'C', sceneId = 's1') => t.board.add({ kind: 'take', origin: 'showrunner', sceneId, takeLabel: label, brief: 'Show the can bigger', reason: 'r' });
  return { ...t, takes, seen, job, product };
}

describe('takes: child films', () => {
  it('three take jobs make three child films of the parent and three rebuilds labelled A, B and C', async () => {
    const t = await setup();
    for (const l of ['A', 'B', 'C'] as const) await t.takes.start(t.job(l), ac(), t.crew);
    const films = await t.film.films.list();
    const children = films.filter((f) => f.parentId === t.film.filmId);
    expect(children).toHaveLength(3);
    expect(children.every((f) => f.crew === false && f.status === 'ready' && f.brief.text === 'test brief')).toBe(true);
    expect(t.seen.map((j) => [j.kind, j.takeLabel, j.sceneId])).toEqual([['rebuild-scene', 'A', 's1'], ['rebuild-scene', 'B', 's1'], ['rebuild-scene', 'C', 's1']]);
    expect(new Set(t.seen.map((j) => j.filmId)).size).toBe(3);
    expect(t.seen.every((j) => j.filmId !== t.film.filmId)).toBe(true);
  });

  it('each child starts from the parent, so the only difference is the scene the take rebuilt', async () => {
    const t = await setup();
    await t.takes.start(t.job('A'), ac(), t.crew);
    const [child] = (await t.film.films.list()).filter((f) => f.parentId === t.film.filmId);
    const parent = (await t.film.films.get(t.film.filmId)).composition as Comp;
    const comp = child!.composition as Comp;
    expect(precomp(comp, 's2')).toEqual(precomp(parent, 's2'));
    expect(precomp(comp, 's1').layers.length).toBe(precomp(parent, 's1').layers.length + 1);
  });

  it('take B ends its brief with the bolder hint, A with as planned, C with calmer', async () => {
    const t = await setup();
    for (const l of ['A', 'B', 'C'] as const) await t.takes.start(t.job(l), ac(), t.crew);
    const briefs = t.seen.map((j) => j.brief);
    expect(briefs[1]).toMatch(/bolder: closer framing, a stronger camera move\)$/);
    expect(briefs[0]).toContain('Show the can bigger');
    expect(briefs[0]).toMatch(/as planned\)$/);
    expect(briefs[2]).toContain(TAKE_HINTS.C);
  });

  it('a stopped job makes no child film', async () => {
    const t = await setup();
    const controller = new AbortController();
    controller.abort();
    await expect(t.takes.start(t.job('A'), controller.signal, t.crew)).rejects.toMatchObject({ name: 'AbortError' });
    expect((await t.film.films.list()).filter((f) => f.parentId)).toHaveLength(0);
  });

  it('a job with no scene is an error', async () => {
    const t = await setup();
    await expect(t.takes.start(t.board.add({ kind: 'take', origin: 'auto', brief: 'b', reason: 'r' }), ac(), t.crew)).rejects.toThrow(/needs a scene/);
  });
});

describe('takes: gallery', () => {
  it('GET /api/films lists the parent and none of its children', async () => {
    const t = await setup();
    await t.takes.start(t.job('A'), ac(), t.crew);
    const base = await makeTestDeps();
    const deps = { ...base, films: t.film.films, makeToolCtx: (id: string) => makeToolCtx(base, id) };
    const list = (await (await createApp(deps).request('/api/films')).json()) as Array<{ id: string; parentId?: string }>;
    expect(list.map((f) => f.id)).toContain(t.film.filmId);
    expect(list.some((f) => f.parentId)).toBe(false);
    expect(list).toHaveLength(1);
    // the child is still reachable by id, for the picker
    const child = (await t.film.films.list()).find((f) => f.parentId)!;
    expect((await createApp(deps).request(`/api/films/${child.id}`)).status).toBe(200);
  });
});

describe('takes: thumbnails and scores', () => {
  it('a finished take emits take.ready with a PNG thumbnail 640 px wide', async () => {
    const t = await setup();
    await t.takes.start(t.job('B'), ac(), t.crew);
    await new Promise((r) => setTimeout(r, 40));
    const ready = t.events.find((e) => e.type === 'take.ready') as Extract<(typeof t.events)[number], { type: 'take.ready' }>;
    expect(ready).toMatchObject({ label: 'B', sceneId: 's1', score: 10 });
    expect(ready.takeFilmId).toMatch(/^film_/);
    const bytes = await t.film.assets.read(ready.thumbAssetId!);
    const meta = await sharp(bytes).metadata();
    expect(meta.format).toBe('png');
    expect(meta.width).toBe(640);
    expect(meta.height).toBe(360);
    expect((await t.film.assets.get(ready.thumbAssetId!)).role).toBe('frame');
  });

  it('one rule finding and one critic finding score 7', async () => {
    const t = await setup();
    const takes = createTakes({ builder: async () => ({ summary: 'built' }), findings: async () => ({ rules: 1, critic: 1 }) });
    await takes.start(t.job('A'), ac(), t.crew);
    await new Promise((r) => setTimeout(r, 40));
    expect(t.events.find((e) => e.type === 'take.ready')).toMatchObject({ score: 7 });
  });

  it('scoreOf: 2 per rule finding, 1 per critic finding, never below 0', () => {
    expect(scoreOf({ rules: 0, critic: 0 })).toBe(10);
    expect(scoreOf({ rules: 1, critic: 1 })).toBe(7);
    expect(scoreOf({ rules: 3, critic: 2 })).toBe(2);
    expect(scoreOf({ rules: 9, critic: 9 })).toBe(0);
  });

  it('by default the score comes from the S5a rules and a blind look at the thumbnail', async () => {
    const t = await setup();
    const prompts: string[] = [];
    const takes = createTakes({
      builder: async () => ({ summary: 'built' }),
      reviewer: async (_images, prompt) => (prompts.push(prompt), { sceneId: 's1', pass: false, issues: [{ image: 1, atSec: 0, kind: 'cut-off', evidence: 'the can is cut off at the edge' }], fixes: [] }),
    });
    await takes.start(t.job('A'), ac(), t.crew);
    await new Promise((r) => setTimeout(r, 40));
    const ready = t.events.find((e) => e.type === 'take.ready') as { score: number; note?: string };
    // the product is one flat colour in this fixture, so the vision step refuses it and the score keeps only the rules
    expect(ready.score).toBe(9); // no rule findings, one finding from the vision look
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('Judge only what is visible.');
    expect(prompts[0]).not.toContain('hero');
  });
});

describe('takes: pick', () => {
  async function picked() {
    const t = await setup();
    await t.takes.start(t.job('B', 's1'), ac(), t.crew);
    const child = (await t.film.films.list()).find((f) => f.parentId === t.film.filmId)!;
    const before = (await t.film.films.get(t.film.filmId)).composition as Comp;
    return { t, child, before };
  }

  it('puts the take scene into the parent and leaves every other scene alone', async () => {
    const { t, child, before } = await picked();
    const r = await t.takes.pick(t.crew, { takeFilmId: child.id, reason: 'bolder' });
    expect(r).toMatchObject({ ok: true, data: { sceneId: 's1', label: 'B' } });
    const after = (await t.film.films.get(t.film.filmId)).composition as Comp;
    expect(precomp(after, 's1')).toEqual(precomp(child.composition as Comp, 's1'));
    expect(precomp(after, 's1')).not.toEqual(precomp(before, 's1'));
    expect(precomp(after, 's2')).toEqual(precomp(before, 's2'));
    expect(after.durationInFrames).toBe(before.durationInFrames);
  });

  it('queues continuity and critique on the parent scene', async () => {
    const { t, child } = await picked();
    await t.takes.pick(t.crew, { takeFilmId: child.id, reason: 'x' });
    expect(t.board.list().filter((j) => j.origin === 'auto').map((j) => [j.kind, j.sceneId])).toEqual([['continuity', 's1'], ['critique', 's1']]);
  });

  it('refuses a film that is a take of another film', async () => {
    const { t, child } = await picked();
    const other = await t.film.films.create({ aspect: '16:9', brief: child.brief, assets: [], parentId: 'film_ffffffffffff', crew: false });
    expect(await t.takes.pick(t.crew, { takeFilmId: other.id, reason: 'x' })).toEqual({ ok: false, error: 'not a take of this film' });
    const plain = await t.film.films.create({ aspect: '16:9', brief: child.brief, assets: [] });
    expect(await t.takes.pick(t.crew, { takeFilmId: plain.id, reason: 'x' })).toEqual({ ok: false, error: 'not a take of this film' });
    expect(await t.takes.pick(t.crew, { takeFilmId: 'film_eeeeeeeeeeee', reason: 'x' })).toMatchObject({ ok: false });
  });

  it('after a restart it still finds the scene, from how the compositions differ', async () => {
    const { t, child } = await picked();
    const fresh = createTakes({ builder: async () => ({}) }); // no memory of the take
    const r = await fresh.pick(t.crew, { takeFilmId: child.id, reason: 'x' });
    expect(r).toMatchObject({ ok: true, data: { sceneId: 's1' } });
  });
});
