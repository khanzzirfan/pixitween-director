import { afterEach, expect, it } from 'vitest';
import { sendJson, startTestServer } from '../meta/test-server';
import { RevanaApiError, RevanaGenerationFailedError } from './errors';
import { createRevanaClient } from './client';
import { completeMinimax, MINIMAX_M3_MODEL } from './chat';
import { filmFromStage, SEEDANCE_MODEL, SeedanceInputError } from './seedance';
import { revanaFromEnv } from './index';
import { loadEnv } from '../env';

const servers: Array<{ close(): Promise<void> }> = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

it('stays off until a Revana key is set', () => {
  expect(revanaFromEnv(loadEnv({}))).toBeUndefined();
  expect(revanaFromEnv(loadEnv({ REVANA_API_KEY: 'sr_live_test' }))).toBeDefined();
});

it('quotes, submits Seedance once, and retries a 503 with the same idempotency key', async () => {
  let creates = 0;
  const srv = await startTestServer((req, res) => {
    expect(req.headers.authorization).toBe('Bearer sr_live_test');
    if (req.url === '/v1/generations/quote') {
      sendJson(res, 200, { quoted_usd: 0.84, reserved_usd: 1.1, enough_credit: true });
      return;
    }
    if (req.url === '/v1/generations' && req.method === 'POST') {
      creates += 1;
      if (creates === 1) {
        sendJson(res, 503, { error: { code: 'busy', message: 'busy' } }, { 'retry-after': '0' });
        return;
      }
      const body = JSON.parse(req.body) as { model: string; max_cost_usd: number; input: { prompt: string } };
      expect(body.model).toBe(SEEDANCE_MODEL);
      expect(body.max_cost_usd).toBe(1.1);
      expect(body.input.prompt).toBe('a slow push in');
      expect(req.headers['idempotency-key']).toBe('job-1');
      sendJson(res, 200, { id: 'gen_1', model: SEEDANCE_MODEL, status: 'queued', cost_usd: null });
      return;
    }
    if (req.url === '/v1/generations/gen_1') {
      sendJson(res, 200, { id: 'gen_1', model: SEEDANCE_MODEL, status: 'succeeded', cost_usd: 0.9, output: { urls: ['https://cdn.example/a.mp4'] } });
      return;
    }
    sendJson(res, 404, { error: { code: 'not_found', message: req.url } });
  });
  servers.push(srv);
  const client = createRevanaClient({ apiKey: 'sr_live_test', baseUrl: srv.baseUrl, sleep: async () => undefined, pollIntervalMs: 0 });
  const done = await client.generate(SEEDANCE_MODEL, { prompt: 'a slow push in' }, { idempotencyKey: 'job-1' });
  expect(done.status).toBe('succeeded');
  expect(done.cost_usd).toBe(0.9);
  expect(creates).toBe(2);
});

it('stops when the generation fails and does not download', async () => {
  const srv = await startTestServer((req, res) => {
    if (req.url === '/v1/generations/gen_bad') {
      sendJson(res, 200, { id: 'gen_bad', model: SEEDANCE_MODEL, status: 'failed', cost_usd: 0, error: { code: 'content_policy', message: 'refused', retryable: false } });
      return;
    }
    sendJson(res, 500, { error: { code: 'server_error', message: 'no' } });
  });
  servers.push(srv);
  const client = createRevanaClient({ apiKey: 'sr_live_test', baseUrl: srv.baseUrl, sleep: async () => undefined, pollIntervalMs: 0 });
  await expect(client.waitFor('gen_bad', { timeoutMs: 10 })).rejects.toBeInstanceOf(RevanaGenerationFailedError);
});

it('uploads stage frames and sends the first and last as bookends', async () => {
  const srv = await startTestServer((req, res) => {
    if (req.url === '/v1/uploads') {
      const n = JSON.parse(req.body).filename as string;
      sendJson(res, 200, { url: `https://api.revana.si/u/${n}`, upload_url: `${srv.baseUrl}/put/${n}`, upload_headers: { 'content-type': 'image/png' } });
      return;
    }
    if (req.url?.startsWith('/v1/put/')) {
      res.writeHead(200);
      res.end();
      return;
    }
    if (req.url === '/v1/generations/quote') {
      sendJson(res, 200, { quoted_usd: 1, reserved_usd: 1.2, enough_credit: true });
      return;
    }
    if (req.url === '/v1/generations' && req.method === 'POST') {
      const body = JSON.parse(req.body) as { model: string; input: { image_url: string; end_image_url: string; image_urls?: string[] } };
      expect(body.model).toBe(SEEDANCE_MODEL);
      expect(body.input.image_url).toContain('frame-1');
      expect(body.input.end_image_url).toContain('frame-2');
      expect(body.input.image_urls).toBeUndefined();
      sendJson(res, 200, { id: 'gen_film', model: SEEDANCE_MODEL, status: 'succeeded', cost_usd: 1 });
      return;
    }
    if (req.url === '/v1/generations/gen_film') {
      sendJson(res, 200, { id: 'gen_film', model: SEEDANCE_MODEL, status: 'succeeded', cost_usd: 1 });
      return;
    }
    if (req.url === '/v1/generations/gen_film/content') {
      res.writeHead(200, { 'content-type': 'video/mp4' });
      res.end(Buffer.from('mp4-bytes'));
      return;
    }
    sendJson(res, 404, { error: { code: 'not_found', message: req.url } });
  });
  servers.push(srv);
  const client = createRevanaClient({ apiKey: 'sr_live_test', baseUrl: srv.baseUrl, sleep: async () => undefined, pollIntervalMs: 0 });
  const film = await filmFromStage(client, {
    prompt: 'the bottle turns in warm light',
    frames: [
      { bytes: Buffer.from('a'), contentType: 'image/png' },
      { bytes: Buffer.from('b'), contentType: 'image/png' },
    ],
    duration: 5,
    resolution: '720p',
    aspectRatio: '9:16',
    audio: true,
  });
  expect(film.mp4.toString()).toBe('mp4-bytes');
  expect(film.input.end_image_url).toContain('frame-2');
});

it('refuses an opening frame mixed with references, and a duration Seedance will not take', async () => {
  const { assertSeedanceInput } = await import('./seedance');
  expect(() => assertSeedanceInput({ prompt: 'x', image_url: 'https://a', image_urls: ['https://b'] })).toThrow(SeedanceInputError);
  expect(() => assertSeedanceInput({ prompt: 'x', duration: 2 })).toThrow(/4 to 30/);
  expect(() => assertSeedanceInput({ prompt: 'x', video_url: 'https://clip', duration: 5 })).toThrow(/Leave duration out/);
});

it('sends three frames as references, not as a first frame', async () => {
  const srv = await startTestServer((req, res) => {
    if (req.url === '/v1/uploads') {
      const n = JSON.parse(req.body).filename as string;
      sendJson(res, 200, { url: `https://api.revana.si/u/${n}`, upload_url: `${srv.baseUrl}/put/${n}`, upload_headers: {} });
      return;
    }
    if (req.url?.startsWith('/v1/put/')) {
      res.writeHead(200);
      res.end();
      return;
    }
    if (req.url === '/v1/generations/quote') {
      sendJson(res, 200, { quoted_usd: 1, reserved_usd: 1, enough_credit: true });
      return;
    }
    if (req.url === '/v1/generations' && req.method === 'POST') {
      const body = JSON.parse(req.body) as { input: { image_url?: string; image_urls: string[] } };
      expect(body.input.image_url).toBeUndefined();
      expect(body.input.image_urls).toHaveLength(3);
      sendJson(res, 200, { id: 'gen_refs', model: SEEDANCE_MODEL, status: 'succeeded', cost_usd: 1 });
      return;
    }
    if (req.url === '/v1/generations/gen_refs') {
      sendJson(res, 200, { id: 'gen_refs', model: SEEDANCE_MODEL, status: 'succeeded', cost_usd: 1 });
      return;
    }
    if (req.url === '/v1/generations/gen_refs/content') {
      res.writeHead(200);
      res.end(Buffer.from('ok'));
      return;
    }
    sendJson(res, 404, {});
  });
  servers.push(srv);
  const client = createRevanaClient({ apiKey: 'sr_live_test', baseUrl: srv.baseUrl, sleep: async () => undefined, pollIntervalMs: 0 });
  const still = (): { bytes: Buffer; contentType: 'image/png' } => ({ bytes: Buffer.from('x'), contentType: 'image/png' });
  const film = await filmFromStage(client, { prompt: 'three angles of the can', frames: [still(), still(), still()], duration: 4 });
  expect(film.input.image_urls).toHaveLength(3);
});

it('asks MiniMax M3 on the chat completions endpoint', async () => {
  const srv = await startTestServer((req, res) => {
    expect(req.url).toBe('/v1/chat/completions');
    const body = JSON.parse(req.body) as { model: string; messages: Array<{ role: string }> };
    expect(body.model).toBe(MINIMAX_M3_MODEL);
    expect(body.messages[0]?.role).toBe('system');
    sendJson(res, 200, { choices: [{ message: { content: 'A slow orbit of the bottle, then a price card.' } }], usage: { cost_usd: 0.002 } });
  });
  servers.push(srv);
  const client = createRevanaClient({ apiKey: 'sr_live_test', baseUrl: srv.baseUrl, sleep: async () => undefined });
  const { motionPrompt } = await import('./chat');
  const wrote = await motionPrompt(client, 'a beach towel, $29');
  expect(wrote.text).toContain('orbit');
  expect(wrote.costUsd).toBe(0.002);
  await expect(completeMinimax(client, [])).rejects.toThrow(/at least one message/);
});

it('does not retry a 422', async () => {
  let hits = 0;
  const srv = await startTestServer((req, res) => {
    hits += 1;
    sendJson(res, 422, { error: { code: 'invalid_input', message: 'bad duration', request_id: 'req_1' } });
  });
  servers.push(srv);
  const client = createRevanaClient({ apiKey: 'sr_live_test', baseUrl: srv.baseUrl, sleep: async () => undefined });
  const err = await client.quote(SEEDANCE_MODEL, { prompt: 'x', duration: 2 }).catch((e) => e);
  expect(err).toBeInstanceOf(RevanaApiError);
  expect(err.code).toBe('invalid_input');
  expect(err.requestId).toBe('req_1');
  expect(hits).toBe(1);
});
