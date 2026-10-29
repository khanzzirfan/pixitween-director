import sharp from 'sharp';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { addLayer, addScene, newFilmComposition } from '../authoring/api';
import { createApp } from './app';
import { makeToolCtx } from './deps';
import { makeTestDeps } from '../test-utils/deps';

const saved = { ...process.env };
beforeEach(() => {
  delete process.env.DIRECTOR_PASSCODE;
  process.env.DIRECTOR_FAKE = '1';
  process.env.DIRECTOR_FAKE_DELAY_MS = '1';
});
afterEach(() => {
  process.env = { ...saved };
});

const json = (body: unknown) => ({ method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });

it('POST /api/films rejects bad input with a coded error', async () => {
  const app = createApp(await makeTestDeps());
  const form = new FormData();
  form.set('brief', 'a mug');
  const res = await app.request('/api/films', { method: 'POST', body: form });
  expect(res.status).toBe(400);
  expect((await res.json()).error).toBe('product_required');
});

it('POST /api/films accepts a photo and brief, returns 202 and runs the fake director to ready', async () => {
  const base = await makeTestDeps();
  // the shared test ctx is pinned to one film; a created film needs a ctx bound to its own id
  const deps = { ...base, makeToolCtx: (id: string) => makeToolCtx(base, id) };
  const app = createApp(deps);
  const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#ccc' } })
    .png()
    .toBuffer();
  const form = new FormData();
  form.set('product', new File([png], 'p.png', { type: 'image/png' }));
  form.set('brief', 'a ceramic mug at sunrise');
  const res = await app.request('/api/films', { method: 'POST', body: form });
  expect(res.status).toBe(202);
  const { filmId } = await res.json();
  expect(filmId).toMatch(/^film_/);
  for (let i = 0; i < 200; i++) {
    const film = await deps.films.get(filmId);
    if (film.status === 'ready' || film.status === 'failed') {
      expect(film.status).toBe('ready');
      expect(film.storyboard?.scenes.length).toBeGreaterThan(0);
      expect(film.composition).toBeDefined();
      return;
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('film never settled');
});

it('chat validates ids and messages, and 409s while the film has no composition', async () => {
  const deps = await makeTestDeps();
  const app = createApp(deps);
  expect((await app.request('/api/films/bad-id/chat', json({ message: 'x' }))).status).toBe(404);
  const empty = await app.request(`/api/films/${deps.filmId}/chat`, json({ message: '   ' }));
  expect(empty.status).toBe(400);
  expect((await empty.json()).error).toBe('bad_message');
  const early = await app.request(`/api/films/${deps.filmId}/chat`, json({ message: 'make it red' }));
  expect(early.status).toBe(409);
  expect((await early.json()).error).toBe('film_not_ready');
});

it('undo and redo walk the version history and refuse at the ends', async () => {
  const deps = await makeTestDeps();
  const app = createApp(deps);
  let comp = newFilmComposition({ aspect: '16:9', title: 'T', palette: ['#111827'] });
  comp = addScene(comp, { id: 's1', durationSec: 4, mode: 'motion', intent: 'hero' });
  await deps.films.commit(deps.filmId, comp, 'director');
  comp = addLayer(comp, { sceneId: 's1', role: 'bg', kind: 'shape', fill: '#111827' });
  await deps.films.commit(deps.filmId, comp, 'user');
  const top = (await deps.films.get(deps.filmId)).version;

  const redoAtEnd = await app.request(`/api/films/${deps.filmId}/redo`, { method: 'POST' });
  expect(redoAtEnd.status).toBe(409);
  const undone = await app.request(`/api/films/${deps.filmId}/undo`, { method: 'POST' });
  expect(undone.status).toBe(200);
  expect((await undone.json()).version).toBe(top - 1);
  const redone = await app.request(`/api/films/${deps.filmId}/redo`, { method: 'POST' });
  expect((await redone.json()).version).toBe(top);
});

it('a queue that fills between canAccept and submit fails the film and answers 429, not a stuck new film', async () => {
  const base = await makeTestDeps();
  const emitted: Array<{ type: string; where?: string }> = [];
  const deps = {
    ...base,
    makeToolCtx: (id: string) => {
      const ctx = makeToolCtx(base, id);
      return { ...ctx, emit: (e: Parameters<typeof ctx.emit>[0]) => (emitted.push(e as { type: string; where?: string }), ctx.emit(e)) };
    },
    admission: {
      canAccept: () => ({ ok: true as const }),
      submit: () => ({ state: 'rejected' as const, retryAfterSec: 17 }),
      position: () => ({ state: 'unknown' as const }),
      stats: () => ({ inFlight: 0, queued: 0, maxInFlight: 1, maxQueued: 0, startsInWindow: 0, startsPerWindow: 1, windowSec: 60 }),
    },
  };
  const before = new Set((await deps.films.list()).map((f) => f.id));
  const app = createApp(deps);
  const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#ccc' } }).png().toBuffer();
  const form = new FormData();
  form.set('product', new File([png], 'p.png', { type: 'image/png' }));
  form.set('brief', 'a ceramic mug at sunrise');
  const res = await app.request('/api/films', { method: 'POST', body: form });
  expect(res.status).toBe(429);
  expect(res.headers.get('retry-after')).toBe('17');
  const created = (await deps.films.list()).filter((f) => !before.has(f.id));
  expect(created).toHaveLength(1);
  expect(created[0]!.status).toBe('failed');
  expect(emitted).toContainEqual(expect.objectContaining({ type: 'error', where: 'admission' }));
});

// ---- crew films (S12b) ----
const crewFilm = async (status: 'building' | 'ready' | 'planning' = 'building') => {
  const base = await makeTestDeps();
  const { filmId: _unused, ...rest } = base;
  void _unused;
  const film = await base.films.create({ aspect: '16:9', brief: { text: 'x', productAssetId: 'ast_' + '0'.repeat(32) }, assets: [], crew: true });
  await base.films.update(film.id, { status });
  const modelCalls: string[] = [];
  const backend = { id: 'wonder' as const, async chatWithTools(m: unknown) { modelCalls.push(JSON.stringify(m)); return { toolCalls: [], ms: 1 }; } };
  const heardAt: number[] = [];
  const deps = {
    ...rest,
    filmId: base.filmId,
    makeToolCtx: (id: string) => {
      const ctx = makeToolCtx(base, id);
      return { ...ctx, emit: (e: Parameters<typeof ctx.emit>[0]) => (e.type === 'showrunner.heard' && heardAt.push(modelCalls.length), ctx.emit(e)) };
    },
  };
  const { bindCrew } = await import('../crew/run-crew');
  bindCrew(deps as never, { backend, idleEndMs: 80 });
  return { deps, filmId: film.id, modelCalls, base, heardAt };
};

it('POST /chat on a crew film that is building returns 202 with an inboxId and emits showrunner.heard before any model call', async () => {
  const { deps, filmId, modelCalls, heardAt } = await crewFilm('building');
  const app = createApp(deps as never);
  const res = await app.request(`/api/films/${filmId}/chat`, json({ message: 'add a sunset scene' }));
  expect(res.status).toBe(202);
  const body = (await res.json()) as { accepted: boolean; inboxId: string };
  expect(body.accepted).toBe(true);
  expect(body.inboxId).toMatch(/^i_/);
  await new Promise((r) => setTimeout(r, 120));
  expect(heardAt).toEqual([0]); // emitted when no model call had been made
  expect(modelCalls).toHaveLength(1);
  expect(modelCalls[0]).toContain('add a sunset scene');
});

it('POST /chat on a non-crew building film still returns 409 film_busy', async () => {
  const base = await makeTestDeps();
  const film = await base.films.create({ aspect: '16:9', brief: { text: 'x', productAssetId: 'ast_' + '0'.repeat(32) }, assets: [] });
  await base.films.commit(film.id, newFilmComposition({ aspect: '16:9', title: 't', palette: ['#111111'] }), 'director'); // a film with a composition, so the busy check is reached
  await base.films.update(film.id, { status: 'building' });
  const res = await createApp({ ...base, makeToolCtx: (id: string) => makeToolCtx(base, id) }).request(`/api/films/${film.id}/chat`, json({ message: 'hello' }));
  expect(res.status).toBe(409);
  expect((await res.json()).error).toBe('film_busy');
});

it('POST /chat on a crew film that has not started or has failed is film_not_ready', async () => {
  const { deps, filmId, base } = await crewFilm('building');
  await base.films.update(filmId, { status: 'failed' });
  expect((await createApp(deps as never).request(`/api/films/${filmId}/chat`, json({ message: 'hello' }))).status).toBe(409);
});

it('POST /undo on a crew film with a running job returns 409 crew_busy, and works when the crew is quiet', async () => {
  const { deps, filmId } = await crewFilm('ready');
  const { ensureCrewSession } = await import('../crew/run-crew');
  const app = createApp(deps as never);
  const session = await ensureCrewSession(filmId);
  const job = session.crew.board.add({ kind: 'build-scene', origin: 'auto', sceneId: 's1' });
  session.crew.board.update(job.id, { status: 'running' });
  const res = await app.request(`/api/films/${filmId}/undo`, { method: 'POST' });
  expect(res.status).toBe(409);
  expect((await res.json()).error).toBe('crew_busy');
  session.crew.board.update(job.id, { status: 'cancelled' });
  const quiet = await app.request(`/api/films/${filmId}/undo`, { method: 'POST' });
  expect((await quiet.json()).error).not.toBe('crew_busy'); // this film has no versions, so the answer is nothing_to_undo
  session.stop();
});
