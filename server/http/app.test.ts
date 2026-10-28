import { afterEach, beforeEach, expect, it } from 'vitest';
import { createApp } from './app';
import { makeTestDeps } from '../test-utils/deps';

const FILM = 'film_3fa9c2d41b7e';
const saved = { ...process.env };
beforeEach(() => {
  delete process.env.DIRECTOR_PASSCODE;
  delete process.env.DIRECTOR_REPLAY;
});
afterEach(() => {
  process.env = { ...saved };
});

const mk = async () => createApp(await makeTestDeps());

it('serves health without a passcode', async () => {
  process.env.DIRECTOR_PASSCODE = 'secret';
  const res = await (await mk()).request('/api/health');
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body).toMatchObject({ ok: true, replay: false, validator: 'light' });
  expect(typeof body.version).toBe('string');
  expect(typeof body.metaConfigured).toBe('boolean');
  expect(typeof body.ffmpeg).toBe('boolean');
});

it('enforces the passcode on mutating routes only', async () => {
  process.env.DIRECTOR_PASSCODE = 'secret';
  const app = await mk();
  const path = `/api/films/${FILM}/chat`;
  const none = await app.request(path, { method: 'POST' });
  const wrong = await app.request(path, { method: 'POST', headers: { 'x-director-passcode': 'nope' } });
  expect(none.status).toBe(401);
  expect(wrong.status).toBe(401);
  expect(await none.json()).toEqual({ error: 'passcode_required' });
  expect(await wrong.json()).toEqual({ error: 'passcode_required' });
  const goodHeaders: Record<string, string>[] = [{ 'x-director-passcode': 'secret' }, { authorization: 'Bearer secret' }];
  for (const headers of goodHeaders) {
    const ok = await app.request(path, { method: 'POST', headers });
    expect(ok.status).toBe(501);
    expect((await ok.json()).owner).toBe('S6');
  }
  expect((await app.request('/api/local-mode')).status).toBe(501); // GET is never blocked
});

it('lets mutating routes through when no passcode is set', async () => {
  expect((await (await mk()).request('/api/films', { method: 'POST' })).status).toBe(501);
});

it('answers 404 JSON for unknown API paths', async () => {
  const res = await (await mk()).request('/api/nope');
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: 'not_found' });
});

it('reports replay mode', async () => {
  process.env.DIRECTOR_REPLAY = '1';
  expect((await (await (await mk()).request('/api/health')).json()).replay).toBe(true);
});
