import { Hono } from 'hono';
import { afterEach, expect, it, vi } from 'vitest';
import type { FilmState } from '@shared/composition';
import { bootHooks } from '../boot';
import type { AppDeps } from './deps';
import { createInstallFilmQueue, installFilmQueue } from './film-queue-install';
import { getLimits } from './limits-config';
import { middlewares } from './middleware';

afterEach(() => vi.unstubAllEnvs());

const film = (id: string, status: FilmState['status'], createdAt: string) => ({ id, status, createdAt }) as FilmState;
const make = (loadDirector?: Parameters<typeof createInstallFilmQueue>[0] extends infer O ? (O extends { loadDirector?: infer L } ? L : never) : never) => {
  const ran: string[] = [];
  const deps = { films: { list: async () => [film('film_b', 'new', '2026-10-29T00:02:00Z'), film('film_a', 'new', '2026-10-29T00:01:00Z'), film('film_c', 'ready', '2026-10-29T00:00:00Z')] } } as unknown as AppDeps;
  const hook = createInstallFilmQueue({
    log: () => undefined,
    loadDirector: loadDirector ?? (async () => ({ bindDirector: () => undefined, runDirector: (id: string) => (ran.push(id), new Promise<void>(() => undefined)) })),
  });
  const app = new Hono();
  for (const m of middlewares) app.use('*', m);
  return { app, deps, hook, ran };
};

it('swaps in the real queue', async () => {
  const { app, deps, hook } = make();
  await hook({ app, deps });
  expect(deps.admission!.stats().maxInFlight).toBe(getLimits().filmsInFlightMax);
  expect(deps.admission!.stats().maxQueued).toBe(getLimits().filmsQueueMax);
});

it('requeues films still new, oldest first, and ignores the rest', async () => {
  const { app, deps, hook, ran } = make();
  await hook({ app, deps });
  await new Promise((r) => setTimeout(r, 0));
  expect(ran).toEqual(['film_a', 'film_b']);
});

it('serves the queue publicly, without a passcode or CORS headers', async () => {
  vi.stubEnv('DIRECTOR_PASSCODE', 'pw');
  vi.stubEnv('FILMS_IN_FLIGHT_MAX', '1');
  const { app, deps, hook } = make();
  await hook({ app, deps });
  const stats = await app.request('/api/queue');
  expect(stats.status).toBe(200);
  expect(await stats.json()).toMatchObject({ inFlight: 1, queued: 1, maxInFlight: 1 });
  expect(stats.headers.get('access-control-allow-origin')).toBeNull();
  expect(await (await app.request('/api/queue/film_b')).json()).toMatchObject({ state: 'queued', position: 1 });
  expect(await (await app.request('/api/queue/nope')).json()).toEqual({ state: 'unknown' });
});

it('only logs when the director is missing', async () => {
  const { app, deps, hook } = make(async () => {
    throw new Error('no director');
  });
  await expect(hook({ app, deps })).resolves.toBeUndefined();
  expect(deps.admission).toBeDefined();
});

it('is registered at boot', () => {
  expect(bootHooks).toContain(installFilmQueue);
});
