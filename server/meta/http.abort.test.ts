import { afterEach, expect, it } from 'vitest';
import { createMetaHttp } from './http';
import { sendJson, startTestServer } from './test-server';

let srv: Awaited<ReturnType<typeof startTestServer>> | undefined;
afterEach(async () => {
  await srv?.close();
  srv = undefined;
});
const http = () => createMetaHttp({ baseUrl: srv!.baseUrl, apiKey: () => 'test-key', retryDelayMs: 0 });
const slow = () => startTestServer((_r, res) => new Promise<void>((done) => setTimeout(() => (sendJson(res, 200, { ok: 1 }), done()), 2000)));

it('an aborted json() call rejects with AbortError well before the server answers, and is not retried', async () => {
  srv = await slow();
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 50);
  const t0 = Date.now();
  const e = await http().json('/x', {}, { signal: ac.signal }).catch((err: unknown) => err);
  expect((e as Error).name).toBe('AbortError');
  expect(Date.now() - t0).toBeLessThan(500);
  await new Promise((r) => setTimeout(r, 100));
  expect(srv.seen).toHaveLength(1);
});

it('a signal that is already aborted sends no request', async () => {
  srv = await slow();
  const e = await http().json('/x', {}, { signal: AbortSignal.abort() }).catch((err: unknown) => err);
  expect((e as Error).name).toBe('AbortError');
  expect(srv.seen).toHaveLength(0);
});

it('form() and sse() honour the signal too', async () => {
  srv = await slow();
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 50);
  const f = await http().form('/x', new FormData(), undefined, { signal: ac.signal }).catch((err: unknown) => err);
  expect((f as Error).name).toBe('AbortError');
  const s = await http().sse('/x', {}, { signal: AbortSignal.abort() }).catch((err: unknown) => err);
  expect((s as Error).name).toBe('AbortError');
});

it('calls without a signal behave as before', async () => {
  srv = await startTestServer((_r, res) => sendJson(res, 200, { ok: 1 }));
  expect((await http().json('/x', {})).body).toEqual({ ok: 1 });
});
