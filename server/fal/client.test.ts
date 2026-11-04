import { afterEach, expect, it } from 'vitest';
import { sendJson, startTestServer } from '../meta/test-server';
import { createFalClient } from './client';

const MODEL = 'minimax/h3-max/reference-to-video';
import { FalApiError } from './errors';

const servers: Array<{ close(): Promise<void> }> = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

it('stores a file on the Fal CDN and returns the url a model can fetch', async () => {
  const calls: Array<{ url: string; method?: string; auth: string | null; body: unknown }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), method: init?.method, auth: new Headers(init?.headers).get('authorization'), body: init?.body });
    if (String(input).includes('/storage/upload/initiate')) {
      return new Response(JSON.stringify({ upload_url: 'https://v3.fal.media/upload/abc', file_url: 'https://v3.fal.media/files/abc.jpg' }), { status: 200 });
    }
    return new Response(null, { status: 200 });
  };
  const client = createFalClient({ apiKey: 'fal-key-1234567890', fetchImpl });
  const url = await client.upload(new Uint8Array([1, 2, 3]), 'image/jpeg', 'shot-1.jpg');
  expect(url).toBe('https://v3.fal.media/files/abc.jpg');
  expect(JSON.parse(String(calls[0]!.body))).toEqual({ content_type: 'image/jpeg', file_name: 'shot-1.jpg' });
  expect(calls[0]!.auth).toBe('Key fal-key-1234567890');
  expect(calls[1]).toMatchObject({ url: 'https://v3.fal.media/upload/abc', method: 'PUT' });
});

it('refuses an upload target that is not https', async () => {
  const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({ upload_url: 'http://10.0.0.1/put', file_url: 'https://v3.fal.media/files/abc.jpg' }), { status: 200 });
  const client = createFalClient({ apiKey: 'fal-key-1234567890', fetchImpl });
  await expect(client.upload(new Uint8Array([1]), 'image/jpeg', 'a.jpg')).rejects.toBeInstanceOf(FalApiError);
});

it('submits with the Fal key and refuses a status URL on another host', async () => {
  const srv = await startTestServer((req, res) => {
    expect(req.headers.authorization).toBe('Key fal-key-1234567890');
    sendJson(res, 200, {
      request_id: 'req_1',
      status_url: 'https://evil.example/status',
      response_url: 'https://evil.example/result',
    });
  });
  servers.push(srv);
  const client = createFalClient({ apiKey: 'fal-key-1234567890', baseUrl: srv.baseUrl.replace(/\/v1$/, '') });
  await expect(client.submit(MODEL, { prompt: 'a reel' })).rejects.toBeInstanceOf(FalApiError);
});

it('polls the queue host and reads the video url', async () => {
  const srv = await startTestServer((req, res) => {
    if (req.method === 'POST') {
      const port = String(req.headers.host).split(':')[1];
      sendJson(res, 200, {
        request_id: 'req_1',
        status_url: `http://127.0.0.1:${port}/minimax/h3-max/requests/req_1/status`,
        response_url: `http://127.0.0.1:${port}/minimax/h3-max/requests/req_1`,
      });
      return;
    }
    if (req.url?.endsWith('/status')) {
      sendJson(res, 200, { status: 'COMPLETED' });
      return;
    }
    sendJson(res, 200, { video: { url: 'https://v3.fal.media/reel.mp4' } });
  });
  servers.push(srv);
  const client = createFalClient({ apiKey: 'fal-key-1234567890', baseUrl: srv.baseUrl.replace(/\/v1$/, ''), sleep: async () => undefined, pollIntervalMs: 0 });
  const handle = await client.submit(MODEL, { prompt: 'a reel', aspect_ratio: '9:16' });
  const result = await client.waitFor(handle, { timeoutMs: 1000 });
  expect(result.videoUrl).toBe('https://v3.fal.media/reel.mp4');
});
