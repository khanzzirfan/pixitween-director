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

const withLog = (loadDirector: Parameters<typeof createInstallFilmQueue>[0] extends infer O ? (O extends { loadDirector?: infer L } ? L : never) : never, films?: FilmState[]) => {
  const lines: string[] = [];
  const deps = { films: { list: async () => films ?? [] } } as unknown as AppDeps;
  const hook = createInstallFilmQueue({ log: (l) => lines.push(l), loadDirector });
  return { lines, deps, hook, app: new Hono() };
};

it('a director that fails to load is logged by name and the hook does not throw', async () => {
  const { lines, deps, hook, app } = withLog(async () => {
    throw new Error('boom');
  });
  await expect(hook({ app, deps })).resolves.toBeUndefined();
  expect(lines).toContain('[queue] director failed to load: boom');
  expect(lines).toContain('[queue] director not available; skipping requeue');
});

it('a director module with no runDirector only says it is not available', async () => {
  const { lines, deps, hook, app } = withLog(async () => ({}));
  await hook({ app, deps });
  expect(lines).toContain('[queue] director not available; skipping requeue');
  expect(lines.some((l) => l.includes('failed to load'))).toBe(false);
});

it('submits three new films oldest first', async () => {
  vi.stubEnv('FILMS_IN_FLIGHT_MAX', '5');
  vi.stubEnv('FILMS_STARTS_PER_WINDOW', '5');
  const ran: string[] = [];
  const { deps, hook, app } = withLog(
    async () => ({ runDirector: (id: string) => (ran.push(id), new Promise<void>(() => undefined)) }),
    [film('c', 'new', '2026-10-29T00:03:00Z'), film('a', 'new', '2026-10-29T00:01:00Z'), film('b', 'new', '2026-10-29T00:02:00Z')],
  );
  await hook({ app, deps });
  await new Promise((r) => setTimeout(r, 0));
  expect(ran).toEqual(['a', 'b', 'c']);
});

it('a film already running through the queue is not started twice by the boot requeue', async () => {
  vi.stubEnv('FILMS_IN_FLIGHT_MAX', '5');
  vi.stubEnv('FILMS_STARTS_PER_WINDOW', '5');
  let runs = 0;
  // the film is still `new` in the store while its first run is in flight
  const { deps, hook, app } = withLog(
    async () => ({ runDirector: () => (runs++, new Promise<void>(() => undefined)) }),
    [film('f1', 'new', '2026-10-29T00:01:00Z')],
  );
  await hook({ app, deps });
  await new Promise((r) => setTimeout(r, 0));
  expect(runs).toBe(1);
  expect(deps.admission!.submit('f1', async () => { runs++; })).toMatchObject({ state: 'running' });
  await new Promise((r) => setTimeout(r, 0));
  expect(runs).toBe(1);
});
