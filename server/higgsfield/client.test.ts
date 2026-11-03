import { afterEach, expect, it } from 'vitest';
import { sendJson, startTestServer } from '../meta/test-server';
import { createHiggsfieldClient, higgsfieldReel, parseHiggsfieldKey } from './client';
import { HiggsfieldApiError } from './errors';

const servers: Array<{ close(): Promise<void> }> = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

it('accepts keyId:secret and rejects a single token', () => {
  expect(parseHiggsfieldKey('key-id-1:secret-value')?.id).toBe('key-id-1');
  expect(parseHiggsfieldKey('not-a-pair')).toBeUndefined();
});

it('sends a 9:16 still reel with the key id and secret, and refuses another host', async () => {
  const reel = higgsfieldReel({ prompt: 'the towel turns', imageUrl: 'https://cdn.example/towel.jpg', duration: 6 });
  expect(reel.input.aspect_ratio).toBe('9:16');
  const srv = await startTestServer((req, res) => {
    expect(req.headers.authorization).toBe('Key key-id-1:secret-value');
    expect(JSON.parse(req.body).aspect_ratio).toBe('9:16');
    sendJson(res, 200, { request_id: 'hf_1', status_url: 'https://evil.example/status' });
  });
  servers.push(srv);
  const client = createHiggsfieldClient({ apiKey: 'key-id-1:secret-value', baseUrl: srv.baseUrl.replace(/\/v1$/, '') });
  await expect(client.submit(reel.endpoint, reel.input)).rejects.toBeInstanceOf(HiggsfieldApiError);
});
