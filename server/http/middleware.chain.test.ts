import { Hono } from 'hono';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PASSCODE_HEADER } from '@shared/api';
import { middlewares } from './middleware';

function app() {
  const a = new Hono();
  for (const m of middlewares) a.use('*', m);
  a.get('/api/films', (c) => c.json([]));
  a.post('/api/films', (c) => c.text('created'));
  a.post('/api/films/:id/scenes/:sceneId/approve', (c) => c.text('approved'));
  return a;
}
const auth = { [PASSCODE_HEADER]: 'pw' };
const createFilm = (a: Hono, headers: Record<string, string> = auth, body: BodyInit = 'x') => a.request('/api/films', { method: 'POST', headers, body });

beforeEach(() => vi.stubEnv('DIRECTOR_PASSCODE', 'pw'));
afterEach(() => vi.unstubAllEnvs());

it('leaves reads public and asks for the passcode on writes', async () => {
  const a = app();
  expect((await a.request('/api/films')).status).toBe(200);
  expect((await createFilm(a, {})).status).toBe(401);
});

it('does not charge a rejected request against the film quota', async () => {
  const a = app();
  for (let i = 0; i < 5; i++) expect((await createFilm(a, {})).status).toBe(401);
  for (let i = 0; i < 3; i++) expect((await createFilm(a)).status).toBe(200);
  expect((await createFilm(a)).status).toBe(429);
});

it('caps approvals after the passcode', async () => {
  const a = app();
  for (let i = 0; i < 4; i++) expect((await a.request(`/api/films/f${i}/scenes/s1/approve`, { method: 'POST', headers: auth })).status).toBe(200);
  expect((await a.request('/api/films/f9/scenes/s1/approve', { method: 'POST', headers: auth })).status).toBe(429);
});

it('rejects a big upload before the handler', async () => {
  const res = await createFilm(app(), auth, new Uint8Array(26 * 1024 * 1024));
  expect(res.status).toBe(413);
});
