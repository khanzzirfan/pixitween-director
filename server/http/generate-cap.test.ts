import { Hono } from 'hono';
import { expect, it } from 'vitest';
import { createGenerateCap } from './generate-cap';

const appWith = (max?: number) => {
  const app = new Hono();
  app.use('*', createGenerateCap({ max }));
  app.all('*', (c) => c.text('ok'));
  return app;
};
const approve = (app: Hono, film: string, scene: string) => app.request(`/api/films/${film}/scenes/${scene}/approve`, { method: 'POST' });

it('passes the default four across films and scenes and denies the fifth', async () => {
  const app = appWith();
  for (const [f, s] of [['f1', 's1'], ['f2', 's1'], ['f1', 's2'], ['f3', 's9']] as const) expect((await approve(app, f, s)).status).toBe(200);
  const denied = await approve(app, 'f4', 's1');
  expect(denied.status).toBe(429);
  expect(await denied.json()).toMatchObject({ error: 'generate_cap' });
});

it('counts only POST approve', async () => {
  const app = appWith(1);
  for (let i = 0; i < 3; i++) {
    expect((await app.request('/api/films/f1/scenes/s1/mode', { method: 'POST' })).status).toBe(200);
    expect((await app.request('/api/films/f1/scenes/s1/approve')).status).toBe(200);
  }
  expect((await approve(app, 'f1', 's1')).status).toBe(200);
  expect((await approve(app, 'f1', 's1')).status).toBe(429);
});

it('honours an injected max', async () => {
  const app = appWith(2);
  await approve(app, 'a', 'b');
  await approve(app, 'a', 'b');
  expect((await approve(app, 'a', 'b')).status).toBe(429);
});

/** An app whose approve handler answers with the status (or throws) the test asks for. */
const statusApp = (max: number) => {
  const app = new Hono();
  app.use('*', createGenerateCap({ max }));
  app.post('/api/films/:f/scenes/:s/approve', (c) => {
    const code = Number(c.req.header('x-status') ?? 202);
    if (code === 500) throw new Error('kaboom');
    return c.json({ code }, code as 202 | 404 | 409);
  });
  app.onError((_e, c) => c.json({ error: 'internal' }, 500));
  return app;
};
const approveAs = (app: Hono, status: number, headers: Record<string, string> = {}) =>
  app.request('/api/films/f/scenes/s/approve', { method: 'POST', headers: { 'x-status': String(status), ...headers } });

it('a 2xx approval uses the budget', async () => {
  const app = statusApp(1);
  expect((await approveAs(app, 202)).status).toBe(202);
  const denied = await approveAs(app, 202);
  expect(denied.status).toBe(429);
  expect(await denied.json()).toMatchObject({ error: 'generate_cap' });
});

it.each([404, 409])('a %i approval gives the slot back', async (code) => {
  const app = statusApp(1);
  expect((await approveAs(app, code)).status).toBe(code);
  expect((await approveAs(app, 202)).status).toBe(202);
});

it('a throwing handler gives the slot back', async () => {
  const app = statusApp(1);
  expect((await approveAs(app, 500)).status).toBe(500);
  expect((await approveAs(app, 202)).status).toBe(202);
});

it('stays one budget across client addresses', async () => {
  const app = statusApp(1);
  expect((await approveAs(app, 202, { 'x-forwarded-for': '1.1.1.1' })).status).toBe(202);
  expect((await approveAs(app, 202, { 'x-forwarded-for': '2.2.2.2' })).status).toBe(429);
});
