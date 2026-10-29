import { Hono } from 'hono';
import { expect, it, vi } from 'vitest';
import { createFilmLimit } from './film-limit';
import { getLimits } from './limits-config';

const appWith = (mw: ReturnType<typeof createFilmLimit>) => {
  const app = new Hono();
  app.use('*', mw);
  app.all('*', (c) => c.text('ok'));
  return app;
};
const post = (app: Hono, path = '/api/films') => app.request(path, { method: 'POST' });

it('lets the default number through and denies the next with a Retry-After', async () => {
  const app = appWith(createFilmLimit({ log: () => undefined }));
  for (let i = 0; i < getLimits().filmsPerHourPerIp; i++) expect((await post(app)).status).toBe(200);
  const denied = await post(app);
  expect(denied.status).toBe(429);
  expect(await denied.json()).toMatchObject({ error: 'rate_limited' });
  expect(Number(denied.headers.get('retry-after'))).toBeGreaterThan(0);
});

it('counts only POST /api/films', async () => {
  const app = appWith(createFilmLimit({ max: 1, log: () => undefined }));
  for (let i = 0; i < 3; i++) {
    expect((await app.request('/api/films')).status).toBe(200);
    expect((await post(app, '/api/films/abc/chat')).status).toBe(200);
  }
  expect((await post(app)).status).toBe(200);
  expect((await post(app)).status).toBe(429);
});

it('logs a hashed key, never the address', async () => {
  const log = vi.fn();
  const app = appWith(createFilmLimit({ max: 1, log }));
  await post(app);
  await post(app);
  expect(log).toHaveBeenCalledOnce();
  expect(log.mock.calls[0]![0]).toMatch(/^\[rate-limit\] key=[0-9a-f]{8} path=\/api\/films/);
});
