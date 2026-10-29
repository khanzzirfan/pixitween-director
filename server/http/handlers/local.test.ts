import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PASSCODE_HEADER } from '@shared/api';
import type { AppDeps } from '../deps';
import { getLocalMode, resetLocalModeForTests, type LocalModeStatus } from '../../llm/local-mode';
import { middlewares } from '../middleware';
import { registerLocalRoutes } from './local';

const ready: LocalModeStatus = { reachable: true, modelPresent: true, loaded: false, model: 'muse-glimmer:30b-mlx', host: 'localhost:11434', checkedAt: '2026-10-29T00:00:00Z' };

function appWith(status: LocalModeStatus) {
  const app = new Hono();
  for (const m of middlewares) app.use('*', m);
  registerLocalRoutes(app, {} as AppDeps, { getStatus: vi.fn(async () => status) });
  return app;
}
const put = (app: Hono, body: unknown, headers: Record<string, string> = {}) =>
  app.request('/api/local-mode', { method: 'PUT', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers } });

beforeEach(() => resetLocalModeForTests(false));
afterEach(() => vi.unstubAllEnvs());

describe('/api/local-mode', () => {
  it('GET returns the flag and the status', async () => {
    const res = await appWith(ready).request('/api/local-mode');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ local: false, reachable: true, modelPresent: true, loaded: false, model: 'muse-glimmer:30b-mlx', host: 'localhost:11434', checkedAt: expect.any(String) });
  });

  it('refuses to turn on when Ollama is down or the model is missing', async () => {
    const down = await put(appWith({ ...ready, reachable: false, modelPresent: false }), { local: true });
    expect(down.status).toBe(409);
    expect((await down.json()).error).toBe('glimmer_unreachable');
    const missing = await put(appWith({ ...ready, modelPresent: false }), { local: true });
    expect((await missing.json()).error).toBe('glimmer_model_missing');
    expect(getLocalMode()).toBe(false);
  });

  it('switches on when ready and off again', async () => {
    const app = appWith(ready);
    const on = await put(app, { local: true });
    expect(on.status).toBe(200);
    expect(getLocalMode()).toBe(true);
    expect((await on.json()).local).toBe(true);
    await put(app, { local: false });
    expect(getLocalMode()).toBe(false);
  });

  it('needs the passcode and a valid body', async () => {
    vi.stubEnv('DIRECTOR_PASSCODE', 'pw');
    const app = appWith(ready);
    expect((await put(app, { local: true })).status).toBe(401);
    expect((await put(app, '{}', { [PASSCODE_HEADER]: 'pw' })).status).toBe(400);
    expect((await put(app, { local: true }, { [PASSCODE_HEADER]: 'pw' })).status).toBe(200);
  });
});
