import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Job } from '@shared/crew';
import type { FilmEvent } from '@shared/events';
import type { Scene, Storyboard } from '@shared/storyboard';
import { sceneIds } from '../authoring/meta';
import type { Comp, Obj } from '../authoring/types';
import { showrunnerSystem } from '../crew/prompts';
import { createCrew } from '../crew/run-crew';
import { makeTestCrew } from '../crew/test-helpers';
import { makeTestDeps } from '../test-utils/deps';
import { blockers, setMember } from './cast';
import { createCartoonTools } from './showrunner-tools';

const saved = { ...process.env };
beforeEach(() => {
  process.env.CARTOON_MODE = 'true';
  process.env.DIRECTOR_FAKE = '1';
  process.env.CREW_ENABLED = 'true';
  process.env.CREW_INBOX_DEBOUNCE_MS = '20';
});
afterEach(() => {
  process.env = { ...saved };
});

const scene: Scene = { id: 's1', durationSec: 4, intent: 'hero', shotType: 'hero', camera: 'static', layersWanted: ['bg'], mode: 'motion', modeReason: 'r', castIds: ['pip'], cues: [{ atSec: 1, actorId: 'pip', clip: 'Wave' }] };
const storyboard: Storyboard = { title: 'T', aspect: '16:9', durationSec: 4, palette: ['#1f2937'], scenes: [scene, { ...scene, id: 's2' }] };

async function setup() {
  const t = await makeTestCrew();
  await t.film.films.update(t.film.filmId, { storyboard });
  const tools = createCartoonTools(t.crew);
  const run = (name: string, args: unknown) => tools.find((x) => x.name === name)!.run(t.crew.toolCtx, args as never);
  return { ...t, run };
}

describe('the toy-studio showrunner tools', () => {
  it('castCharacter, dressSet and requestMotion each add a cast member and dispatch a forge job', async () => {
    const t = await setup();
    expect((await t.run('castCharacter', { name: 'Pip', description: 'a toy' })).ok).toBe(true);
    expect((await t.run('dressSet', { place: 'a toy room', props: ['crate'] })).ok).toBe(true);
    expect((await t.run('requestMotion', { name: 'Wave' })).ok).toBe(true);
    const film = await t.film.films.get(t.film.filmId);
    expect(film.cast?.map((m) => `${m.kind}:${m.id}`)).toEqual(['character:pip', 'set:a-toy-room', 'prop:crate', 'motion:wave']);
    expect(t.board.list().map((j) => j.kind)).toEqual(['cast-character', 'make-set', 'make-prop', 'make-motion']);
    // asking again for the same thing makes no second job
    await t.run('castCharacter', { name: 'Pip', description: 'a toy' });
    expect(t.board.list()).toHaveLength(4);
  });

  it('caps a film at 3 characters and a set at 4 props', async () => {
    const t = await setup();
    for (const n of ['A', 'B', 'C']) await t.run('castCharacter', { name: n, description: n });
    const r = await t.run('castCharacter', { name: 'D', description: 'D' });
    expect(r.ok).toBe(false);
    const dress = createCartoonTools(t.crew).find((x) => x.name === 'dressSet')!;
    expect(dress.params.safeParse({ place: 'x', props: ['1', '2', '3', '4', '5'] }).success).toBe(false);
  });

  it('blockShot names the cast member that is still running, and the missing motion', async () => {
    const t = await setup();
    await t.run('castCharacter', { name: 'Pip', description: 'a toy' });
    await setMember(t.film.films, t.film.filmId, 'pip', { status: 'running' });
    const r = await t.run('blockShot', { sceneId: 's1' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/character 'pip' is running/);
      expect(r.error).toMatch(/motion 'Wave' has not been requested/);
    }
    expect(t.board.list().some((j) => j.kind === 'block-shot')).toBe(false);
  });

  it('blockShot dispatches once everything the scene needs is ready', async () => {
    const t = await setup();
    await t.run('castCharacter', { name: 'Pip', description: 'a toy' });
    await t.run('requestMotion', { name: 'Wave' });
    await setMember(t.film.films, t.film.filmId, 'pip', { status: 'ready' });
    await setMember(t.film.films, t.film.filmId, 'wave', { status: 'ready' });
    expect(blockers(await t.film.films.get(t.film.filmId), 's1')).toEqual([]);
    const r = await t.run('blockShot', { sceneId: 's1' });
    expect(r.ok).toBe(true);
    expect(t.board.list().at(-1)).toMatchObject({ kind: 'block-shot', sceneId: 's1' });
  });

  it('lightCue sets the scene light on the storyboard', async () => {
    const t = await setup();
    expect((await t.run('lightCue', { sceneId: 's2', cue: 'night' })).ok).toBe(true);
    expect((await t.film.films.get(t.film.filmId)).storyboard?.scenes.find((s) => s.id === 's2')?.lightCue).toBe('night');
  });
});

it("the showrunner prompt says 'locked camera' only in CARTOON_MODE", () => {
  expect(showrunnerSystem(false, true)).toMatch(/locked camera/);
  expect(showrunnerSystem(false, false)).not.toMatch(/locked camera/);
});

const lastJobs = (events: FilmEvent[]): Job[] => {
  const byId = new Map<string, Job>();
  for (const e of events) if (e.type === 'job.update') byId.set(e.job.id, e.job);
  return [...byId.values()];
};

describe('the offline cartoon crew', () => {
  it('casts, blocks three shots and ends ready, with no network call', { timeout: 20_000 }, async () => {
    const deps = await makeTestDeps();
    await createCrew(deps, { fakeDelayMs: 20, idleEndMs: 3000 }).runCrew(deps.filmId);
    await new Promise((r) => setTimeout(r, 60));
    const film = await deps.films.get(deps.filmId);
    expect(film.status).toBe('ready');
    expect(film.cast?.map((m) => `${m.id}:${m.status}${m.error ?? ''}`)).toEqual(['pip:ready', 'a-sunny-toy-room:ready', 'crate:ready', 'wave:ready', 'walk:ready', 'jump:ready']);
    const comp = film.composition as Comp;
    expect(sceneIds(comp)).toEqual(['s1', 's2', 's3']);
    for (const id of ['s1', 's2', 's3']) {
      const layers = (comp.precomps as Record<string, Obj>)[id]!.layers as Obj[];
      expect(layers.map((l) => l.kind)).toEqual(expect.arrayContaining(['stage3d', 'actor3d']));
    }
    const jobs = lastJobs(deps.events);
    // under load the showrunner and auto-dispatch can both block a scene; each scene must be blocked at least once
    expect([...new Set(jobs.filter((j) => j.kind === 'block-shot' && j.status === 'done').map((j) => j.sceneId))].sort()).toEqual(['s1', 's2', 's3']);
    expect(jobs.filter((j) => j.status === 'failed')).toEqual([]);
  });
});

describe('the fixture forge', () => {
  it('makes a character even before the film has a composition (the showrunner casts before it plans)', async () => {
    const { createFixtureForge } = await import('./fixture-forge');
    const t = await makeTestCrew();
    const tools = createCartoonTools(t.crew);
    expect((await t.film.films.get(t.film.filmId)).composition).toBeUndefined();
    await tools.find((x) => x.name === 'castCharacter')!.run(t.crew.toolCtx, { name: 'Pip', description: 'a toy' } as never);
    const job = t.board.list()[0]!;
    await createFixtureForge({ delayMs: 1 })['cast-character'](job, new AbortController().signal, t.crew);
    const film = await t.film.films.get(t.film.filmId);
    expect(film.cast?.[0]).toMatchObject({ id: 'pip', status: 'ready', assetId: 'cast-pip' });
    expect(Object.keys((film.composition as Comp).assets)).toContain('cast-pip');
  });
});
