import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { ConfigError } from '../errors';
import { createMetaHttp } from './http';
import { ReplayMissError, requestKey } from './replay';
import { sendJson, startTestServer } from './test-server';

const key = (json: unknown) => requestKey({ method: 'POST', path: '/p', json });

it('is stable across key order', () => expect(key({ a: 1, b: { c: 2, d: 3 } })).toBe(key({ b: { d: 3, c: 2 }, a: 1 })));

it('hashes data URLs by their decoded bytes', () => {
  const a = key({ u: 'data:image/png;base64,AAAA' });
  expect(a).toBe(key({ u: 'data:image/png;base64,AAAA' }));
  expect(a).not.toBe(key({ u: 'data:image/png;base64,BBBB' }));
  expect(a).toMatch(/^[a-f0-9]{64}$/);
});

it('records without headers, replays without the network, and reports a miss', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'replay-'));
  const srv = await startTestServer((_r, res) => sendJson(res, 200, { hello: 'world' }));
  try {
    const rec = createMetaHttp({ baseUrl: srv.baseUrl, apiKey: () => 'secret-key', mode: { record: { dir } } });
    const live = await rec.json('/p', { q: 1 });
    expect(srv.seen).toHaveLength(1);
    const files = readdirSync(dir);
    expect(files).toHaveLength(1);
    const text = readFileSync(join(dir, files[0]!), 'utf8');
    expect(text).not.toContain('Authorization');
    expect(text).not.toContain('secret-key');

    const rep = createMetaHttp({ baseUrl: srv.baseUrl, mode: { replay: { dir } } });
    const replayed = await rep.json('/p', { q: 1 });
    expect(replayed.status).toBe(live.status);
    expect(replayed.body).toEqual(live.body);
    expect(srv.seen).toHaveLength(1); // no new request

    const miss = await rep.json('/p', { q: 2 }).catch((e) => e);
    expect(miss).toBeInstanceOf(ReplayMissError);
    expect(miss.message).toMatch(/[a-f0-9]{64}/);
  } finally {
    await srv.close();
  }
});

it('rejects both modes at once', () => {
  expect(() => createMetaHttp({ baseUrl: 'http://x', mode: { replay: { dir: 'a' }, record: { dir: 'b' } } })).toThrow(ConfigError);
});
