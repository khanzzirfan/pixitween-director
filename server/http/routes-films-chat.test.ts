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
