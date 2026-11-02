import sharp from 'sharp';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { FilmAdmission } from '@shared/ports';
import { makeToolCtx } from './deps';
import { makeTestDeps } from '../test-utils/deps';

const runCrew = vi.fn(async (_id: string) => undefined);
const bindCrew = vi.fn(); // called when the routes register, whatever the setting
const runDirector = vi.fn(async (_id: string) => undefined);
vi.mock('../crew/run-crew', () => ({ runCrew: (id: string) => runCrew(id), bindCrew: (d: unknown) => bindCrew(d) }));
vi.mock('../agent/director', () => ({ runDirector: (id: string) => runDirector(id), bindDirector: () => undefined }));

const { createApp } = await import('./app');

const saved = { ...process.env };
beforeEach(() => {
  delete process.env.DIRECTOR_PASSCODE;
  vi.clearAllMocks();
});
afterEach(() => {
  process.env = { ...saved };
});

async function post(crew: 'true' | 'false') {
  process.env.CREW_ENABLED = crew;
  const base = await makeTestDeps();
  let run: (() => Promise<void>) | undefined;
  const admission: FilmAdmission = {
    canAccept: () => ({ ok: true }),
    submit: (_id, fn) => ((run = fn), { state: 'running' }),
    position: () => ({ state: 'unknown' }),
    stats: () => ({ inFlight: 0, queued: 0, maxInFlight: 1, maxQueued: 0, startsInWindow: 0, startsPerWindow: 1, windowSec: 60 }),
  };
  const deps = { ...base, admission, makeToolCtx: (id: string) => makeToolCtx(base, id) };
  const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#ccc' } }).png().toBuffer();
  const form = new FormData();
  form.set('product', new File([png], 'p.png', { type: 'image/png' }));
  form.set('brief', 'a ceramic mug at sunrise');
  const res = await createApp(deps).request('/api/films', { method: 'POST', body: form });
  const { filmId } = (await res.json()) as { filmId: string };
  await run!();
  return { res, film: await deps.films.get(filmId), filmId };
}

it('with CREW_ENABLED=true the film is a crew film and the admission run calls runCrew', async () => {
  const { res, film, filmId } = await post('true');
  expect(res.status).toBe(202);
  expect(film.crew).toBe(true);
  expect(runCrew).toHaveBeenCalledWith(filmId);
  expect(runDirector).not.toHaveBeenCalled();
});

it('with CREW_ENABLED=false the film is not a crew film and runDirector is used', async () => {
  const { res, film, filmId } = await post('false');
  expect(res.status).toBe(202);
  expect(film.crew).toBeUndefined();
  expect(runDirector).toHaveBeenCalledWith(filmId);
  expect(runCrew).not.toHaveBeenCalled();
});
