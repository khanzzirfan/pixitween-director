import { readFileSync } from 'node:fs';
import { afterEach, expect, it } from 'vitest';
import type { AepCompositionJson } from 'reacthub-pixitweenjs';
import { createApp } from './app';
import { fixturePath } from '../test-utils/fixtures';
import { makeTestFilm } from '../test-utils/film';

const load = (f: string) => JSON.parse(readFileSync(fixturePath('s02', `valid/${f}.json`), 'utf8')) as AepCompositionJson;
const saved = process.env.DIRECTOR_PASSCODE;
afterEach(() => {
  if (saved === undefined) delete process.env.DIRECTOR_PASSCODE;
  else process.env.DIRECTOR_PASSCODE = saved;
});

async function setup() {
  const t = await makeTestFilm();
  await t.films.commit(t.filmId, load('shape-only'), 'director');
  await t.films.commit(t.filmId, load('text'), 'chat');
  const app = createApp({ films: t.films, assets: t.assets, meta: t.meta, ledger: t.ledger, bus: t.bus, makeToolCtx: () => t.ctx });
  return { t, app };
}

it('serves a film and its versions', async () => {
  const { t, app } = await setup();
  const film = await (await app.request(`/api/films/${t.filmId}`)).json();
  expect(film.version).toBe(2);
  expect(typeof film.composition).toBe('object');
  const versions = await (await app.request(`/api/films/${t.filmId}/versions`)).json();
  expect(versions.map((v: { version: number }) => v.version)).toEqual([1, 2]);
  expect(versions[0]).not.toHaveProperty('parent');
});

it('lists newest first and 404s unknown films', async () => {
  const { t, app } = await setup();
  const newer = await t.films.create({ aspect: '1:1', brief: { text: 'n', productAssetId: 'x' }, assets: [], createdAt: new Date(Date.now() + 10_000).toISOString() });
  const list = await (await app.request('/api/films')).json();
  expect(list.map((f: { id: string }) => f.id)).toEqual([newer.id, t.filmId]);
  const res = await app.request('/api/films/film_000000000000');
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: 'not_found' });
  expect((await app.request('/api/films/film_..%2Fx')).status).toBe(404);
});

it('serves asset bytes without a passcode, with caching headers', async () => {
  process.env.DIRECTOR_PASSCODE = 'secret';
  const { t, app } = await setup();
  const film = await t.films.get(t.filmId);
  const id = film.brief.productAssetId;
  const res = await app.request(`/api/assets/${id}`);
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toBe('image/png');
  expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
  expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  expect(Buffer.from(await res.arrayBuffer()).equals(await t.assets.read(id))).toBe(true);
});

it('404s malformed and unknown asset ids', async () => {
  const { app } = await setup();
  for (const id of ['..%2Fetc%2Fpasswd', 'ast_0123456789abcdef', 'ast_' + '0'.repeat(32)]) {
    expect((await app.request(`/api/assets/${id}`)).status).toBe(404);
  }
});
