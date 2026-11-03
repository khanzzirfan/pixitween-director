import { afterEach, expect, it } from 'vitest';
import { sendJson, startTestServer } from '../meta/test-server';
import { createFalClient, falReel, FAL_REEL_IMAGE, FAL_REEL_TEXT } from './client';
import { FalApiError } from './errors';

const servers: Array<{ close(): Promise<void> }> = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

it('builds a 9:16 text reel and an image reel without an aspect field', () => {
  expect(falReel({ prompt: 'a towel turns' })).toMatchObject({ model: FAL_REEL_TEXT, input: { aspect_ratio: '9:16' } });
  const image = falReel({ prompt: 'a towel turns', imageUrl: 'https://cdn.example/towel.jpg' });
  expect(image.model).toBe(FAL_REEL_IMAGE);
  expect(image.input).not.toHaveProperty('aspect_ratio');
  expect(image.input.image_url).toBe('https://cdn.example/towel.jpg');
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
  await expect(client.submit(FAL_REEL_TEXT, { prompt: 'a reel' })).rejects.toBeInstanceOf(FalApiError);
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
  const handle = await client.submit(FAL_REEL_TEXT, { prompt: 'a reel', aspect_ratio: '9:16' });
  const result = await client.waitFor(handle, { timeoutMs: 1000 });
  expect(result.videoUrl).toBe('https://v3.fal.media/reel.mp4');
});
