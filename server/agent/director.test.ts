import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeFakeMeta } from '../meta/fakes';
import { makeTestFilm } from '../test-utils/film';
import { createDirector } from './director';

const saved = { ...process.env };
beforeEach(() => {
  delete process.env.DIRECTOR_FAKE;
});
afterEach(() => {
  process.env = { ...saved };
});

const depsFor = (t: Awaited<ReturnType<typeof makeTestFilm>>) => ({
  films: t.films,
  assets: t.assets,
  meta: t.meta,
  ledger: t.ledger,
  bus: t.bus,
  makeToolCtx: () => t.ctx,
});

describe('createDirector', () => {
  it('builds a ready film from the fake plan with one layer set per scene', async () => {
    process.env.DIRECTOR_FAKE = '1';
    const t = await makeTestFilm();
    await createDirector(depsFor(t), { delayMs: 0 }).runDirector(t.filmId);
    const film = await t.films.get(t.filmId);
    expect(film.status).toBe('ready');
    expect(film.storyboard?.scenes).toHaveLength(3);
    expect(Object.keys(film.composition?.precomps ?? {})).toEqual(['s1', 's2', 's3']);
    expect(t.events.map((e) => e.type)).toEqual(expect.arrayContaining(['director.storyboard', 'film.status']));
  });

  it("with PRODUCT_3D the fake plan has a 3d hero scene, and the film ends ready with s1:product3d in it", async () => {
    process.env.DIRECTOR_FAKE = '1';
    process.env.PRODUCT_3D = 'true';
    const t = await makeTestFilm();
    await createDirector(depsFor(t), { delayMs: 0 }).runDirector(t.filmId);
    const film = await t.films.get(t.filmId);
    expect(film.status).toBe('ready');
    expect(film.storyboard).toMatchObject({ productShape: 'can' });
    expect(film.storyboard?.scenes[0]).toMatchObject({ id: 's1', mode: '3d' });
    expect(film.storyboard?.scenes[1]?.mode).toBe('generate');
    const s1 = (film.composition?.precomps as Record<string, { layers: Array<{ id: string; kind: string }> }>).s1!.layers;
    expect(s1.find((l) => l.id === 's1:product3d')?.kind).toBe('model3d');
    expect(s1.some((l) => l.id === 's1:product')).toBe(false);
  });

  it('without PRODUCT_3D the same fake plan has no 3d scene and no 3D layer', async () => {
    process.env.DIRECTOR_FAKE = '1';
    delete process.env.PRODUCT_3D;
    const t = await makeTestFilm();
    await createDirector(depsFor(t), { delayMs: 0 }).runDirector(t.filmId);
    const film = await t.films.get(t.filmId);
    expect(film.storyboard?.scenes.map((s) => s.mode)).toEqual(['motion', 'generate', 'motion']);
    expect(JSON.stringify(film.composition)).not.toContain('model3d');
  });

  it('marks the film failed and emits an error when the storyboard cannot be parsed', async () => {
    const t = await makeTestFilm();
    const bad = { content: 'this is not json', toolCalls: [], ms: 1, model: 'muse-spark-1.3-contributor' };
    t.ctx.meta = makeFakeMeta({ sparkScript: [bad, bad, bad] });
    await createDirector(depsFor(t), { delayMs: 0 }).runDirector(t.filmId);
    expect((await t.films.get(t.filmId)).status).toBe('failed');
    await new Promise((r) => setTimeout(r, 50)); // the bus delivers after it has appended to disk
    expect(t.events.some((e) => e.type === 'error' && e.where === 'director')).toBe(true);
  });

  it('ignores a second start for a film that is already running', async () => {
    process.env.DIRECTOR_FAKE = '1';
    const t = await makeTestFilm();
    const director = createDirector(depsFor(t), { delayMs: 0 });
    const first = director.runDirector(t.filmId);
    expect(director.isRunning(t.filmId)).toBe(true);
    await director.runDirector(t.filmId);
    await first;
    expect(director.isRunning(t.filmId)).toBe(false);
    expect(t.events.filter((e) => e.type === 'director.storyboard')).toHaveLength(1);
  });
});
