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
