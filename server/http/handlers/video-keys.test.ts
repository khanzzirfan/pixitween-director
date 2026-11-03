import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { middlewares } from '../middleware';
import { registerVideoRoutes } from './video-keys';

const FAL = 'fal-key-1234567890';
const saved = { ...process.env };

function cookieFrom(res: Response): string {
  const all = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  const set = all[0] ?? res.headers.get('set-cookie') ?? '';
  return set.split(';')[0] ?? '';
}

function appFor(dir: string, fetchImpl: typeof fetch = fetch) {
  const app = new Hono();
  for (const mw of middlewares) app.use('*', mw);
  registerVideoRoutes(app, { dataDir: () => dir, fetchImpl });
  return app;
}

beforeEach(() => {
  process.env.DIRECTOR_PASSCODE = 'secret';
  process.env.TRUST_FLY_CLIENT_IP = 'true';
});
afterEach(() => {
  process.env = { ...saved };
  vi.unstubAllGlobals();
});

it('saves a Fal key without a Muse passcode and will not show it to another IP', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'video-keys-'));
  const app = appFor(dir);
  const savedKey = await app.request('/api/video-keys', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'fly-client-ip': '203.0.113.7' },
    body: JSON.stringify({ fal: FAL }),
  });
  expect(savedKey.status).toBe(200);
  const body = await savedKey.json();
  expect(body).toEqual({ fal: true, higgsfield: false, revana: false });
  expect(JSON.stringify(body)).not.toContain(FAL);
  const cookie = cookieFrom(savedKey);
  expect(cookie.startsWith('mr_video=')).toBe(true);

  const mine = await app.request('/api/video-keys', { headers: { cookie, 'fly-client-ip': '203.0.113.7' } });
  expect(await mine.json()).toEqual({ fal: true, higgsfield: false, revana: false });

  const other = await app.request('/api/video-keys', { headers: { cookie, 'fly-client-ip': '198.51.100.4' } });
  expect(other.status).toBe(403);
  expect(await other.json()).toEqual({ error: 'ip_locked' });

  const stolen = await app.request('/api/video-keys', {
    method: 'PUT',
    headers: { cookie, 'content-type': 'application/json', 'fly-client-ip': '198.51.100.4' },
    body: JSON.stringify({ fal: 'replacement-key-123456' }),
  });
  expect(stolen.status).toBe(403);
  const still = await app.request('/api/video-keys', { headers: { cookie, 'fly-client-ip': '203.0.113.7' } });
  expect(await still.json()).toEqual({ fal: true, higgsfield: false, revana: false });
});

it('spends the Fal key only for the session and IP that saved it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'video-jobs-'));
  const calls: Array<{ url: string; authorization: string }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    calls.push({ url: String(input), authorization: headers.get('authorization') ?? '' });
    const url = String(input);
    if (init?.method === 'POST') {
      return new Response(JSON.stringify({
        request_id: 'req_1',
        status_url: 'https://queue.fal.run/minimax/h3-max/requests/req_1/status',
        response_url: 'https://queue.fal.run/minimax/h3-max/requests/req_1',
      }), { status: 200 });
    }
    if (url.endsWith('/status')) return new Response(JSON.stringify({ status: 'COMPLETED' }), { status: 200 });
    return new Response(JSON.stringify({ video: { url: 'https://v3.fal.media/reel.mp4' } }), { status: 200 });
  };
  const app = appFor(dir, fetchImpl);
  const savedKey = await app.request('/api/video-keys', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'fly-client-ip': '203.0.113.7' },
    body: JSON.stringify({ fal: FAL, higgsfield: 'not a pair' }),
  });
  expect(savedKey.status).toBe(400);
  const good = await app.request('/api/video-keys', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'fly-client-ip': '203.0.113.7' },
    body: JSON.stringify({ fal: FAL }),
  });
  const cookie = cookieFrom(good);
  const otherIp = await app.request('/api/videos', {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json', 'fly-client-ip': '198.51.100.4' },
    body: JSON.stringify({ provider: 'fal', prompt: 'a 9:16 reel of a towel' }),
  });
  expect(otherIp.status).toBe(403);
  expect(calls).toHaveLength(0);

  const started = await app.request('/api/videos', {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json', 'fly-client-ip': '203.0.113.7' },
    body: JSON.stringify({ provider: 'fal', prompt: 'a 9:16 reel of a towel', duration: 6 }),
  });
  expect(started.status).toBe(202);
  expect(calls[0]?.authorization).toBe(`Key ${FAL}`);
  expect(calls[0]?.url).toContain('text-to-video');
  const job = (await started.json()) as { id: string };
  expect(JSON.stringify(job)).not.toContain(FAL);

  const stranger = await app.request('/api/video-keys', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'fly-client-ip': '203.0.113.9' },
    body: JSON.stringify({ fal: 'other-fal-key-123456' }),
  });
  const otherCookie = cookieFrom(stranger);
  const hidden = await app.request(`/api/videos/${job.id}`, { headers: { cookie: otherCookie, 'fly-client-ip': '203.0.113.9' } });
  expect(hidden.status).toBe(404);

  const done = await app.request(`/api/videos/${job.id}`, { headers: { cookie, 'fly-client-ip': '203.0.113.7' } });
  expect(await done.json()).toMatchObject({ id: job.id, provider: 'fal', status: 'succeeded', videoUrl: 'https://v3.fal.media/reel.mp4' });
});
