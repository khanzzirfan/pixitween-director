import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Job } from '@shared/crew';
import type { FilmEvent } from '@shared/events';
import { sceneIds } from '../authoring/meta';
import type { Comp } from '../authoring/types';
import type { FakeCall } from '../meta/fakes';
import { makeTestDeps } from '../test-utils/deps';
import { createCrew } from './run-crew';

const saved = { ...process.env };
beforeEach(() => {
  process.env.DIRECTOR_FAKE = '1';
  process.env.CREW_ENABLED = 'true';
  process.env.CREW_INBOX_DEBOUNCE_MS = '20';
});
afterEach(() => {
  process.env = { ...saved };
});

const settle = (ms = 40) => new Promise<void>((r) => setTimeout(r, ms));
const lastJobs = (events: FilmEvent[]): Job[] => {
  const byId = new Map<string, Job>();
  for (const e of events) if (e.type === 'job.update') byId.set(e.job.id, e.job);
  return [...byId.values()];
};
const overlap = (a: Job, b: Job) => Date.parse(a.startedAt!) < Date.parse(b.endedAt!) && Date.parse(b.startedAt!) < Date.parse(a.endedAt!);

describe('a whole fake crew film', () => {
  it('ends ready with four scenes, and four builders ran at the same time', async () => {
    const deps = await makeTestDeps();
    await createCrew(deps, { fakeDelayMs: 25, idleEndMs: 500 }).runCrew(deps.filmId);
    await settle();
    const film = await deps.films.get(deps.filmId);
    expect(film.status).toBe('ready');
    expect(film.storyboard?.scenes).toHaveLength(4);
    expect(sceneIds(film.composition as Comp)).toEqual(['s1', 's2', 's3', 's4']);
    const builds = lastJobs(deps.events).filter((j) => j.kind === 'build-scene');
    expect(builds.length).toBeGreaterThanOrEqual(4);
    expect(builds.every((j) => j.status === 'done')).toBe(true);
    const overlapping = builds.filter((a) => builds.some((b) => b !== a && overlap(a, b)));
    expect(overlapping.length).toBeGreaterThanOrEqual(4);
    expect(film.styleBible?.palette).toHaveLength(3);
  });

  it('every built scene has a background, the product and its headline', async () => {
    const deps = await makeTestDeps();
    await createCrew(deps, { fakeDelayMs: 15, idleEndMs: 400 }).runCrew(deps.filmId);
    const comp = (await deps.films.get(deps.filmId)).composition as Comp;
    for (const id of ['s1', 's2', 's3', 's4']) {
      const ids = ((comp.precomps as Record<string, { layers: Array<{ id: string }> }>)[id]!.layers).map((l) => l.id);
      expect(ids).toEqual(expect.arrayContaining([`${id}:bg`, `${id}:headline`]));
    }
  });

  it('a message mid-build adds a fifth scene as the third, restyles for warmer light, and still ends ready', async () => {
    const deps = await makeTestDeps();
    const crew = createCrew(deps, { fakeDelayMs: 40, idleEndMs: 600 });
    const session = await crew.start(deps.filmId);
    for (let i = 0; i < 200 && !session.crew.board.list().some((j) => j.status === 'running'); i++) await settle(10);
    session.push({ from: 'user', text: 'add a sunset scene after scene 2, and warmer light everywhere' });
    await session.done;
    await settle();
    const film = await deps.films.get(deps.filmId);
    expect(film.storyboard?.scenes.map((s) => s.id)).toEqual(['s1', 's2', 's5', 's3', 's4']);
    expect(sceneIds(film.composition as Comp)).toEqual(['s1', 's2', 's5', 's3', 's4']);
    expect(film.status).toBe('ready');
    const jobs = lastJobs(deps.events);
    expect(jobs.filter((j) => j.kind === 'restyle-scene' && j.status === 'done').length).toBeGreaterThanOrEqual(4);
    expect(jobs.find((j) => j.kind === 'build-scene' && j.sceneId === 's5')?.status).toBe('done');
    expect(deps.events.find((e) => e.type === 'showrunner.say' && e.kind === 'reply')).toBeDefined();
  });

  it('three takes of a scene come back as take.ready events with scores, as child films', async () => {
    const deps = await makeTestDeps();
    const crew = createCrew(deps, { fakeDelayMs: 25, idleEndMs: 600 });
    const session = await crew.start(deps.filmId);
    for (let i = 0; i < 200 && !session.crew.board.list().some((j) => j.status === 'running'); i++) await settle(10);
    session.push({ from: 'user', text: 'give me three takes of scene 3' });
    await session.done;
    await settle();
    const takes = deps.events.filter((e) => e.type === 'take.ready');
    expect(takes.map((t) => t.type === 'take.ready' && t.label).sort()).toEqual(['A', 'B', 'C']);
    const first = takes[0]!;
    if (first.type !== 'take.ready') throw new Error('unreachable');
    expect(first.sceneId).toBe('s3');
    expect((await deps.films.get(first.takeFilmId)).parentId).toBe(deps.filmId);
    expect(lastJobs(deps.events).filter((j) => j.kind === 'take').every((j) => j.status === 'done')).toBe(true);
    expect((await deps.films.get(deps.filmId)).status).toBe('ready');
  });

  it('answers the critic finding with one fix', async () => {
    const deps = await makeTestDeps();
    await createCrew(deps, { fakeDelayMs: 15, idleEndMs: 400 }).runCrew(deps.filmId);
    await settle();
    const fixes = lastJobs(deps.events).filter((j) => j.kind === 'fix');
    expect(fixes).toHaveLength(1);
    expect(fixes[0]).toMatchObject({ status: 'done', sceneId: 's1' });
  });

  it('makes no Meta request', async () => {
    const deps = await makeTestDeps();
    await createCrew(deps, { fakeDelayMs: 10, idleEndMs: 300 }).runCrew(deps.filmId);
    expect((deps.meta as unknown as { calls: FakeCall[] }).calls).toEqual([]);
  });

  it('records the turns and the work in the ledger, so the budget meter has numbers', async () => {
    const deps = await makeTestDeps();
    await createCrew(deps, { fakeDelayMs: 10, idleEndMs: 300 }).runCrew(deps.filmId);
    expect(deps.ledger.total(deps.filmId)).toBeGreaterThan(0.3);
    expect(deps.ledger.total(deps.filmId)).toBeLessThan(1.5);
  });
});

describe('a fake crew film with PRODUCT_3D', () => {
  it('has a 3d hero scene, builds s1:product3d and ends ready', async () => {
    process.env.PRODUCT_3D = 'true';
    const deps = await makeTestDeps();
    await createCrew(deps, { fakeDelayMs: 25, idleEndMs: 500 }).runCrew(deps.filmId);
    await settle();
    const film = await deps.films.get(deps.filmId);
    expect(film.status).toBe('ready');
    expect(film.storyboard).toMatchObject({ productShape: 'can' });
    expect(film.storyboard?.scenes.map((s) => s.mode)).toEqual(['3d', 'motion', 'motion', 'motion']);
    const s1 = (film.composition!.precomps as Record<string, { layers: Array<{ id: string; kind: string }> }>).s1!.layers;
    expect(s1.find((l) => l.id === 's1:product3d')?.kind).toBe('model3d');
    expect(s1.some((l) => l.id === 's1:product')).toBe(false);
    expect(lastJobs(deps.events).filter((j) => j.kind === 'build-scene').every((j) => j.status === 'done')).toBe(true);
  });

  it('is exactly the old film without it', async () => {
    delete process.env.PRODUCT_3D;
    const deps = await makeTestDeps();
    await createCrew(deps, { fakeDelayMs: 15, idleEndMs: 400 }).runCrew(deps.filmId);
    const film = await deps.films.get(deps.filmId);
    expect(film.storyboard?.scenes.map((s) => s.mode)).toEqual(['motion', 'motion', 'motion', 'motion']);
    expect(JSON.stringify(film.composition)).not.toContain('model3d');
  });
});
