import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { bootHooks } from './boot';
import { loadEnv } from './env';
import { buildDeps, createServerApp } from './main';

afterEach(() => void (bootHooks.length = 0));
const tmp = () => mkdtempSync(join(tmpdir(), 'main-'));

it('builds deps without an API key', async () => {
  const env = loadEnv({ DATA_DIR: tmp() });
  const deps = await buildDeps(env);
  for (const k of ['films', 'assets', 'meta', 'ledger', 'bus'] as const) expect(deps[k]).toBeDefined();
  expect(deps.admission!.stats().maxInFlight).toBe(env.FILMS_IN_FLIGHT_MAX);
  expect(deps.makeToolCtx('film_aaaaaaaaaaaa').filmId).toBe('film_aaaaaaaaaaaa');
});

it('runs hooks once, after the routes, before static files', async () => {
  const root = tmp();
  mkdirSync(join(root, 'dist'));
  writeFileSync(join(root, 'dist', 'index.html'), '<html>spa</html>');
  let runs = 0;
  let healthRegistered = false;
  bootHooks.push(async ({ app }) => {
    runs++;
    // Not app.request(): sending a request builds Hono's matcher, after which no route can be added.
    healthRegistered = app.routes.some((r) => r.path === '/api/health');
    app.get('/api/hooked', (c) => c.json({ hooked: true }));
  });
  const app = await createServerApp(await buildDeps(loadEnv({ DATA_DIR: tmp() })), { staticRoot: join(root, 'dist') });
  expect(runs).toBe(1);
  expect(healthRegistered).toBe(true);
  expect((await app.request('/api/hooked')).status).toBe(200);
  const spa = await app.request('/watch');
  expect(spa.status).toBe(200);
  expect(await spa.text()).toContain('spa');
  expect((await app.request('/api/unknown')).status).toBe(404);
});
