import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { expect, it } from 'vitest';
import { mountStatic } from './static';

function dist() {
  const root = mkdtempSync(join(tmpdir(), 'dist-'));
  mkdirSync(join(root, 'assets'));
  writeFileSync(join(root, 'index.html'), '<html>spa</html>');
  writeFileSync(join(root, 'assets', 'app.js'), 'console.log(1)');
  return root;
}

it('serves files and falls back to index.html', async () => {
  const app = new Hono();
  expect(mountStatic(app, { root: dist() })).toBe(true);
  const index = await app.request('/');
  expect(index.status).toBe(200);
  expect(await index.text()).toContain('spa');
  const js = await app.request('/assets/app.js');
  expect(js.headers.get('content-type')).toMatch(/javascript/);
  const route = await app.request('/some/route');
  expect(route.status).toBe(200);
  expect(await route.text()).toContain('spa');
});

it('keeps /api/* JSON 404s', async () => {
  const app = new Hono();
  mountStatic(app, { root: dist() });
  const res = await app.request('/api/unknown');
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: 'not_found' });
});

it('does nothing without a dist', async () => {
  const app = new Hono();
  expect(mountStatic(app, { root: join(tmpdir(), 'no-such-dist-xyz') })).toBe(false);
  expect((await app.request('/')).status).toBe(404);
});
