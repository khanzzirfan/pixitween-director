import type { FilmState } from '@shared/composition';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeFakeMeta } from '../meta/fakes';
import { makeTestFilm } from '../test-utils/film';
import { createDirector } from './director';

const saved = { ...process.env };
beforeEach(() => {
  process.env.CREW_ENGINE = 'langgraph';
  delete process.env.PRODUCT_3D;
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

const settle = () => new Promise((r) => setTimeout(r, 30));

interface Shape {
  scenes: unknown;
  precomps: Record<string, Array<{ id: string; kind: string }>>;
}

function shape(film: FilmState): Shape {
  const precomps = (film.composition?.precomps ?? {}) as Record<string, { layers?: Array<{ id: string; kind: string }> }>;
  return {
    scenes: film.storyboard?.scenes,
    precomps: Object.fromEntries(
      Object.entries(precomps).map(([id, p]) => [id, (p.layers ?? []).map((l) => ({ id: l.id, kind: l.kind }))]),
    ),
  };
}

async function run(engine: 'native' | 'langgraph') {
  process.env.CREW_ENGINE = engine;
  process.env.DIRECTOR_FAKE = '1';
  const t = await makeTestFilm();
  await createDirector(depsFor(t), { delayMs: 0 }).runDirector(t.filmId);
  await settle();
  return { t, film: await t.films.get(t.filmId) };
}

describe('the sequential director on LangGraph', () => {
  it('builds the same storyboard, events and composition as the native engine', async () => {
    const native = await run('native');
    const graph = await run('langgraph');
    expect(graph.film.status).toBe('ready');
    expect(graph.film.storyboard).toEqual(native.film.storyboard);
    expect(graph.t.events.map((e) => e.type)).toEqual(native.t.events.map((e) => e.type));
    expect(shape(graph.film)).toEqual(shape(native.film));
  });

  it('marks the film failed and emits a director error when the storyboard cannot be parsed', async () => {
    process.env.DIRECTOR_FAKE = '';
    const t = await makeTestFilm();
    const bad = { content: 'this is not json', toolCalls: [], ms: 1, model: 'muse-spark-1.3-contributor' };
    t.ctx.meta = makeFakeMeta({ sparkScript: [bad, bad, bad] });
    await createDirector(depsFor(t), { delayMs: 0 }).runDirector(t.filmId);
    expect((await t.films.get(t.filmId)).status).toBe('failed');
    await settle();
    expect(t.events.some((e) => e.type === 'error' && e.where === 'director')).toBe(true);
  });

  it('ignores a second start for a film that is already running', async () => {
    process.env.DIRECTOR_FAKE = '1';
    const t = await makeTestFilm();
    const director = createDirector(depsFor(t), { delayMs: 20 });
    const first = director.runDirector(t.filmId);
    expect(director.isRunning(t.filmId)).toBe(true);
    await director.runDirector(t.filmId);
    await first;
    expect(director.isRunning(t.filmId)).toBe(false);
    await settle();
    expect(t.events.filter((e) => e.type === 'director.storyboard')).toHaveLength(1);
  });
});
