import { afterEach, describe, expect, it } from 'vitest';
import { META_TIMEOUT_MS, MetaApiError, MetaConfigError, createMetaHttp } from './http';
import { sendJson, startTestServer } from './test-server';

let srv: Awaited<ReturnType<typeof startTestServer>> | undefined;
afterEach(async () => {
  await srv?.close();
  srv = undefined;
});
const http = (o: Partial<Parameters<typeof createMetaHttp>[0]> = {}) =>
  createMetaHttp({ baseUrl: srv!.baseUrl, apiKey: () => 'test-key', retryDelayMs: 0, ...o });

describe('meta http', () => {
  it('returns status and parsed body, with a Bearer header', async () => {
    srv = await startTestServer((_r, res) => sendJson(res, 200, { ok: 1 }));
    const r = await http().json('/x', { a: 1 });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: 1 });
    expect(srv.seen[0]!.headers.authorization).toBe('Bearer test-key');
    expect(JSON.parse(srv.seen[0]!.body)).toEqual({ a: 1 });
  });

  it('never retries a 400 and truncates the body to 500 chars', async () => {
    srv = await startTestServer((_r, res) => sendJson(res, 400, { error: { message: 'x'.repeat(2000) } }));
    const e = await http().json('/x', {}).catch((err) => err);
    expect(e).toBeInstanceOf(MetaApiError);
    expect(e.status).toBe(400);
    expect(e.body.length).toBeLessThanOrEqual(500);
    expect(srv.seen).toHaveLength(1);
  });

  it('retries one 402 billing_not_configured', async () => {
    srv = await startTestServer((_r, res, n) => (n === 1 ? sendJson(res, 402, { error: { code: 'billing_not_configured' } }) : sendJson(res, 200, { ok: true })));
    expect((await http().json('/x', {})).status).toBe(200);
    expect(srv.seen).toHaveLength(2);
  });

  it('throws after two 402s', async () => {
    srv = await startTestServer((_r, res) => sendJson(res, 402, { error: { code: 'billing_not_configured' } }));
    await expect(http().json('/x', {})).rejects.toMatchObject({ status: 402 });
    expect(srv.seen).toHaveLength(2);
  });

  it('does not retry a 500', async () => {
    srv = await startTestServer((_r, res) => sendJson(res, 500, {}));
    await expect(http().json('/x', {})).rejects.toBeInstanceOf(MetaApiError);
    expect(srv.seen).toHaveLength(1);
  });

  it('throws MetaConfigError before any network I/O', async () => {
    srv = await startTestServer((_r, res) => sendJson(res, 200, {}));
    await expect(http({ apiKey: () => undefined }).json('/x', {})).rejects.toBeInstanceOf(MetaConfigError);
    expect(srv.seen).toHaveLength(0);
  });

  it('has a 15 minute timeout', () => expect(META_TIMEOUT_MS).toBe(900000));

  it('retries a 429 up to 3 times', async () => {
    srv = await startTestServer((_r, res, n) => (n <= 2 ? sendJson(res, 429, {}, { 'retry-after': '0' }) : sendJson(res, 200, { ok: true })));
    expect((await http().json('/x', {})).status).toBe(200);
    expect(srv.seen).toHaveLength(3);
  });

  it('gives up after four 429s', async () => {
    srv = await startTestServer((_r, res) => sendJson(res, 429, {}, { 'retry-after': '0' }));
    await expect(http().json('/x', {})).rejects.toMatchObject({ status: 429 });
    expect(srv.seen).toHaveLength(4);
  });

  it('caps Retry-After at 30 s', async () => {
    srv = await startTestServer((_r, res, n) => (n === 1 ? sendJson(res, 429, {}, { 'retry-after': '120' }) : sendJson(res, 200, {})));
    const waits: number[] = [];
    await http({ sleep: async (ms) => void waits.push(ms) }).json('/x', {});
    expect(waits).toEqual([30000]);
  });

  it('caps requests in flight', async () => {
    srv = await startTestServer(async (_r, res) => {
      await new Promise((r) => setTimeout(r, 30));
      sendJson(res, 200, {});
    });
    const h = http({ maxInflight: 2 });
    await Promise.all(Array.from({ length: 6 }, () => h.json('/x', {})));
    expect(srv.seen).toHaveLength(6);
    expect(srv.maxConcurrent).toBeLessThanOrEqual(2);
  });

  it('sse returns the full text with the event-stream Accept header', async () => {
    srv = await startTestServer((_r, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end('data: {"a":1}\n\n');
    });
    const r = await http().sse('/responses', { stream: true });
    expect(r.text).toContain('data:');
    expect(srv.seen[0]!.headers.accept).toBe('text/event-stream');
  });
});
