import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { StoryboardOp } from '@shared/crew';
import type { FilmStore, LlmBackend } from '@shared/ports';
import type { Scene } from '@shared/storyboard';
import { addLayer } from '../../authoring/api';
import type { Comp, Obj } from '../../authoring/types';
import { bindCrew, ensureCrewSession } from '../../crew/run-crew';
import { reviseStoryboard } from '../../crew/showrunner-tools';
import { clearWorkers, registerWorker } from '../../crew/workers';
import { makeTestDeps } from '../../test-utils/deps';
import { createApp } from '../app';
import { makeToolCtx } from '../deps';
import { describeOps, registerCrewRoutes } from './crew';

const saved = { ...process.env };
beforeEach(() => {
  delete process.env.DIRECTOR_PASSCODE;
  process.env.CREW_INBOX_DEBOUNCE_MS = '5000'; // a system item must not wake the showrunner during these tests
});
afterEach(() => {
  process.env = { ...saved };
  clearWorkers();
});

const scene: Omit<Scene, 'id'> = { durationSec: 4, intent: 'a scene', shotType: 'hero', camera: 'static', layersWanted: ['bg'], mode: 'motion', modeReason: 'a still is enough' };
const adds = (n: number): StoryboardOp[] => Array.from({ length: n }, () => ({ op: 'add' as const, scene }));
const post = (body?: unknown) => ({ method: 'POST', body: body === undefined ? undefined : JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const settle = (ms = 30) => new Promise<void>((r) => setTimeout(r, ms));

async function setup() {
  const base = await makeTestDeps();
  const film = await base.films.create({ aspect: '16:9', brief: { text: 'a mug', productAssetId: 'ast_' + '0'.repeat(32) }, assets: [], crew: true });
  await base.films.update(film.id, { status: 'ready' });
  const modelCalls: string[] = [];
  const backend: LlmBackend = { id: 'wonder', async chatWithTools(m) { modelCalls.push(JSON.stringify(m)); return { toolCalls: [], ms: 1 }; } };
  const deps = { ...base, makeToolCtx: (id: string) => makeToolCtx(base, id) };
  bindCrew(deps, { backend, idleEndMs: 60_000 });
  const app = createApp(deps);
  registerCrewRoutes(app, deps);
  const session = await ensureCrewSession(film.id);
  return { app, deps, base, filmId: film.id, session, modelCalls };
}

describe('GET /log and /crew', () => {
  it('returns the film events in order and needs no passcode', async () => {
    process.env.DIRECTOR_PASSCODE = 'secret';
    const s = await setup();
    const ctx = s.deps.makeToolCtx(s.filmId);
    ctx.emit({ type: 'film.status', status: 'planning' });
    ctx.emit({ type: 'film.status', status: 'building' });
    await settle();
    const res = await s.app.request(`/api/films/${s.filmId}/log`);
    expect(res.status).toBe(200);
    const events = (await res.json()) as Array<{ type: string; status?: string }>;
    expect(events.map((e) => e.status)).toEqual(['planning', 'building']);
    s.session.stop();
  });

  it('GET /crew lists the board, the bible and the rev, and is 404 for an unknown film', async () => {
    const s = await setup();
    await reviseStoryboard(s.session.crew, adds(2));
    s.session.crew.board.add({ kind: 'build-scene', origin: 'auto', sceneId: 's1' });
    const body = (await (await s.app.request(`/api/films/${s.filmId}/crew`)).json()) as { jobs: Array<{ id: string }>; storyboardRev: number };
    expect(body.jobs.map((j) => j.id)).toEqual(['j1']);
    expect(body.storyboardRev).toBe(1);
    expect((await s.app.request('/api/films/film_ffffffffffff/crew')).status).toBe(404);
    s.session.stop();
  });
});

describe('POST /storyboard', () => {
  it('applies a camera edit at once, returns the new rev, starts no builder and makes no model call', async () => {
    const s = await setup();
    await reviseStoryboard(s.session.crew, adds(3));
    const res = await s.app.request(`/api/films/${s.filmId}/storyboard`, post({ ops: [{ op: 'update', sceneId: 's2', patch: { camera: 'pan' } }] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ rev: 2 });
    expect((await s.deps.films.get(s.filmId)).storyboard?.scenes[1]?.camera).toBe('pan');
    expect(s.session.crew.board.list()).toEqual([]);
    expect(s.modelCalls).toEqual([]);
    s.session.stop();
  });

  it('an added card gets a user-priority builder and puts the film back to building', async () => {
    registerWorker('build-scene', () => new Promise(() => undefined));
    const s = await setup();
    await reviseStoryboard(s.session.crew, adds(2));
    const res = await s.app.request(`/api/films/${s.filmId}/storyboard`, post({ ops: [{ op: 'add', scene, after: 's1' }] }));
    expect(res.status).toBe(200);
    expect(s.session.crew.board.list().map((j) => [j.kind, j.sceneId, j.origin])).toEqual([['build-scene', 's3', 'user']]);
    expect((await s.deps.films.get(s.filmId)).status).toBe('building');
    s.session.stop();
  });

  it('tells the showrunner what the user did, as a system item', async () => {
    const s = await setup();
    await reviseStoryboard(s.session.crew, adds(3));
    await s.app.request(`/api/films/${s.filmId}/storyboard`, post({ ops: [{ op: 'move', sceneId: 's3', after: null }] }));
    expect(s.session.crew.inbox.size()).toBe(1);
    s.session.stop();
  });

  it('refuses a bad batch with the reason and a non-crew film', async () => {
    const s = await setup();
    await reviseStoryboard(s.session.crew, adds(2));
    const bad = await s.app.request(`/api/films/${s.filmId}/storyboard`, post({ ops: [{ op: 'remove', sceneId: 's9' }] }));
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { message: string }).message).toContain('s9');
    expect((await s.app.request(`/api/films/${s.filmId}/storyboard`, post({ ops: [] }))).status).toBe(400);
    const plain = await s.base.films.create({ aspect: '16:9', brief: { text: 'x', productAssetId: 'ast_' + '0'.repeat(32) }, assets: [] });
    expect((await s.app.request(`/api/films/${plain.id}/storyboard`, post({ ops: adds(2) }))).status).toBe(409);
    s.session.stop();
  });

  it('describeOps names each kind of edit', () => {
    expect(describeOps([{ op: 'add', scene, after: 's2' }, { op: 'remove', sceneId: 's4' }, { op: 'move', sceneId: 's3', after: null }, { op: 'update', sceneId: 's1', patch: { camera: 'pan', text: 'Hi' } }])).toBe(
      'The user edited the storyboard: added a scene after s2; removed s4; moved s3 to the start; changed camera, text of s1.',
    );
  });
});

describe('POST /jobs/:jobId/cancel', () => {
  it('stops a running job and tells the showrunner', async () => {
    registerWorker('build-scene', (_job, signal) => new Promise((_res, rej) => signal.addEventListener('abort', () => rej(new Error('stopped')))));
    const s = await setup();
    await reviseStoryboard(s.session.crew, adds(2));
    await s.session.scheduler.dispatch({ kind: 'build-scene', sceneId: 's1', origin: 'showrunner', brief: 'b', reason: 'r' });
    await settle();
    const res = await s.app.request(`/api/films/${s.filmId}/jobs/j1/cancel`, post());
    expect(await res.json()).toEqual({ ok: true });
    expect(s.session.crew.board.get('j1')!.status).toBe('cancelled');
    expect((await s.app.request(`/api/films/${s.filmId}/jobs/j1/cancel`, post())).status).toBe(409);
    expect((await s.app.request(`/api/films/${s.filmId}/jobs/j9/cancel`, post())).status).toBe(404);
    s.session.stop();
  });
});

describe('POST /scenes/:sceneId/revert', () => {
  it('is 409 nothing_to_revert when the scene has no earlier finished job', async () => {
    const s = await setup();
    await reviseStoryboard(s.session.crew, adds(2));
    expect(await (await s.app.request(`/api/films/${s.filmId}/scenes/s1/revert`, post())).json()).toEqual({ error: 'nothing_to_revert' });
    registerWorker('build-scene', async () => ({ summary: 'one' }));
    await s.session.scheduler.dispatch({ kind: 'build-scene', sceneId: 's1', origin: 'auto', brief: 'b', reason: 'r' });
    await s.session.scheduler.idle();
    expect((await s.app.request(`/api/films/${s.filmId}/scenes/s1/revert`, post())).status).toBe(409); // one finished job: nothing before it
    s.session.stop();
  });

  it('puts the scene back to how the job before the latest one left it', async () => {
    const layersOf = async (s: Awaited<ReturnType<typeof setup>>) => ((await s.deps.films.get(s.filmId)).composition!.precomps as Record<string, Obj>).s1!.layers.map((l: Obj) => l.id as string);
    const add = (text: string) => async (job: { sceneId?: string; id: string }, _sig: AbortSignal, crew: { films: FilmStore; filmId: string }) => {
      await crew.films.mutate(crew.filmId, (f) => ({ next: addLayer(f.composition as Comp, { sceneId: job.sceneId!, role: 'caption', kind: 'text', text }), data: null }), 'director', job.id);
      return { summary: text };
    };
    registerWorker('build-scene', add('first') as never);
    registerWorker('restyle-scene', add('second') as never);
    const s = await setup();
    await reviseStoryboard(s.session.crew, adds(2));
    await s.session.scheduler.dispatch({ kind: 'build-scene', sceneId: 's1', origin: 'auto', brief: 'b', reason: 'r' });
    await s.session.scheduler.idle();
    const afterFirst = await layersOf(s);
    await s.session.scheduler.dispatch({ kind: 'restyle-scene', sceneId: 's1', origin: 'user', brief: 'b', reason: 'r' });
    await s.session.scheduler.idle();
    expect((await layersOf(s)).length).toBe(afterFirst.length + 1);
    const res = await s.app.request(`/api/films/${s.filmId}/scenes/s1/revert`, post());
    expect(res.status).toBe(200);
    expect(await layersOf(s)).toEqual(afterFirst);
    expect(s.session.crew.board.list().find((j) => j.kind === 'revert')).toMatchObject({ status: 'done', origin: 'user', sceneId: 's1' });
    s.session.stop();
  });
});

describe('POST /voice', () => {
  it('a 1 KB text/plain body is 415', async () => {
    const s = await setup();
    const res = await s.app.request(`/api/films/${s.filmId}/voice`, { method: 'POST', body: 'x'.repeat(1024), headers: { 'content-type': 'text/plain' } });
    expect(res.status).toBe(415);
    s.session.stop();
  });

  it('an audio field that is not audio is 415, and a missing one is 400', async () => {
    const s = await setup();
    const form = new FormData();
    form.set('audio', new File(['x'.repeat(1024)], 'a.txt', { type: 'text/plain' }));
    expect((await s.app.request(`/api/films/${s.filmId}/voice`, { method: 'POST', body: form })).status).toBe(415);
    expect((await s.app.request(`/api/films/${s.filmId}/voice`, { method: 'POST', body: new FormData() })).status).toBe(400);
    s.session.stop();
  });
});
