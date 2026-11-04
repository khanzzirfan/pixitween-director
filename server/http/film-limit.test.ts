import { Hono } from 'hono';
import { expect, it, vi } from 'vitest';
import { createFilmLimit } from './film-limit';
import { createRateLimiter } from './rate-limit';
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
  expect(log.mock.calls[0]![0]).toMatch(/^\[rate-limit\] key=[0-9a-f]{8} path=\/api\/films limit=1\/hour retryAfterSec=\d+$/);
  expect(log.mock.calls[0]![0]).not.toContain('window=3/3');
});

/** A handler whose status the test picks per request, so each case can say what the film did. */
const statusApp = (mw: ReturnType<typeof createFilmLimit>, wait = false) => {
  const app = new Hono();
  app.use('*', mw);
  app.post('/api/films', async (c) => {
    if (wait) await new Promise((r) => setTimeout(r, 5));
    const code = Number(c.req.header('x-status') ?? 202);
    if (code === 500) throw new Error('kaboom');
    return c.json({ code }, code as 202 | 400 | 429);
  });
  app.onError((_e, c) => c.json({ error: 'internal' }, 500));
  return app;
};
const send = (app: Hono, status: number) => app.request('/api/films', { method: 'POST', headers: { 'x-status': String(status) } });

it('a 202 uses a slot', async () => {
  const app = statusApp(createFilmLimit({ max: 1, log: () => undefined }));
  expect((await send(app, 202)).status).toBe(202);
  expect((await send(app, 202)).status).toBe(429);
});

it('a 400 gives the slot back', async () => {
  const app = statusApp(createFilmLimit({ max: 1, log: () => undefined }));
  expect((await send(app, 400)).status).toBe(400);
  expect((await send(app, 202)).status).toBe(202);
});

it('a 429 busy from the handler gives the slot back', async () => {
  const app = statusApp(createFilmLimit({ max: 1, log: () => undefined }));
  expect((await send(app, 429)).status).toBe(429);
  expect((await send(app, 202)).status).toBe(202);
});

it('a throwing handler gives the slot back and the error still reaches the client', async () => {
  const app = statusApp(createFilmLimit({ max: 1, log: () => undefined }));
  const res = await send(app, 500);
  expect(res.status).toBe(500);
  expect(await res.json()).toEqual({ error: 'internal' });
  expect((await send(app, 202)).status).toBe(202);
});

it('admits exactly max of simultaneous requests', async () => {
  const max = 2;
  const app = statusApp(createFilmLimit({ max, log: () => undefined }), true);
  const results = await Promise.all(Array.from({ length: max + 2 }, () => send(app, 202)));
  const codes = results.map((r) => r.status);
  expect(codes.filter((c) => c === 202)).toHaveLength(max);
  expect(codes.filter((c) => c === 429)).toHaveLength(2);
});

it('a refunded slot does not lengthen Retry-After', async () => {
  const t = 1_000_000;
  const mk = () => statusApp(createFilmLimit({ max: 1, limiter: createRateLimiter({ windowMs: 3_600_000, max: 1, now: () => t }), log: () => undefined }));
  const refunded = mk();
  await send(refunded, 400);
  await send(refunded, 202);
  const clean = mk();
  await send(clean, 202);
  const a = await send(refunded, 202);
  const b = await send(clean, 202);
  expect(a.status).toBe(429);
  expect(a.headers.get('retry-after')).toBe(b.headers.get('retry-after'));
});
