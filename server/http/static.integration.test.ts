import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { Hono } from 'hono';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { mountStatic } from './static';

const HTML = '<!doctype html><title>t</title>';
let app: Hono;
let base = '';

beforeAll(() => {
  // serveStatic wants a root under the working directory, so build the temp tree inside it
  base = mkdtempSync(join(process.cwd(), '.static-it-'));
  mkdirSync(join(base, 'assets'));
  writeFileSync(join(base, 'index.html'), HTML);
  writeFileSync(join(base, 'assets', 'app.js'), 'console.log(1)');
  app = new Hono();
  app.get('/api/ping', (c) => c.json({ ok: true }));
  app.notFound((c) => (c.req.path.startsWith('/api/') ? c.json({ error: 'not_found' }, 404) : c.text('Not found', 404)));
  expect(mountStatic(app, { root: relative(process.cwd(), base) })).toBe(true);
});

afterAll(() => rmSync(base, { recursive: true, force: true }));

it('serves the app at / and falls back to it for client routes', async () => {
  expect(await (await app.request('/')).text()).toBe(HTML);
  const route = await app.request('/some/client/route');
  expect(route.status).toBe(200);
  expect(await route.text()).toBe(HTML);
});

it('serves assets with a javascript content type', async () => {
  const res = await app.request('/assets/app.js');
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toMatch(/javascript/);
  expect(await res.text()).toBe('console.log(1)');
});

it('keeps the API as JSON, including a missing route', async () => {
  expect(await (await app.request('/api/ping')).json()).toEqual({ ok: true });
  const missing = await app.request('/api/missing');
  expect(missing.status).toBe(404);
  expect(await missing.json()).toEqual({ error: 'not_found' });
});
