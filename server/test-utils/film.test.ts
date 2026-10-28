import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import type { AepCompositionJson } from 'reacthub-pixitweenjs';
import { fixturePath } from './fixtures';
import { makeTestFilm } from './film';

const shape = JSON.parse(readFileSync(fixturePath('s02', 'valid/shape-only.json'), 'utf8')) as AepCompositionJson;

it('starts empty and collects events', async () => {
  const t = await makeTestFilm();
  expect((await t.films.get(t.filmId)).version).toBe(0);
  t.ctx.emit({ type: 'film.status', status: 'planning' });
  await new Promise((r) => setTimeout(r, 50));
  expect(t.events).toHaveLength(1);
  expect(t.events[0]).toMatchObject({ type: 'film.status', filmId: t.filmId });
  expect(t.events[0]!.at).toMatch(/^\d{4}-/);
});

it('commits the given composition as version 1', async () => {
  const t = await makeTestFilm({ composition: shape });
  expect((await t.films.get(t.filmId)).version).toBe(1);
  expect(await t.ctx.films.commit(t.filmId, shape, 'director')).toEqual({ ok: true, version: 2 });
});

it('ledger writes reach the event list', async () => {
  const t = await makeTestFilm();
  t.ledger.add(t.filmId, 'm', 'u', 0.01);
  await new Promise((r) => setTimeout(r, 50));
  expect(t.events.map((e) => e.type)).toContain('cost');
});
