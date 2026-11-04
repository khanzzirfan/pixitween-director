import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { middlewares } from '../middleware';
import { registerVideoRoutes } from './video-keys';

const FAL = 'fal-key-1234567890';
const saved = { ...process.env };

function cookieFrom(res: Response): string {
  const all = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  const set = all[0] ?? res.headers.get('set-cookie') ?? '';
  return set.split(';')[0] ?? '';
}

function appFor(dir: string) {
  const app = new Hono();
  for (const mw of middlewares) app.use('*', mw);
  registerVideoRoutes(app, { dataDir: () => dir });
  return app;
}

beforeEach(() => {
  process.env.DIRECTOR_PASSCODE = 'secret';
  process.env.TRUST_FLY_CLIENT_IP = 'true';
});
afterEach(() => {
  process.env = { ...saved };
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
  expect(body).toEqual({ fal: true });
  expect(JSON.stringify(body)).not.toContain(FAL);
  const cookie = cookieFrom(savedKey);
  expect(cookie.startsWith('mr_video=')).toBe(true);

  const mine = await app.request('/api/video-keys', { headers: { cookie, 'fly-client-ip': '203.0.113.7' } });
  expect(await mine.json()).toEqual({ fal: true });

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
  expect(await still.json()).toEqual({ fal: true });
});

it('refuses a key that is too short without storing anything', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'video-keys-'));
  const app = appFor(dir);
  const res = await app.request('/api/video-keys', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'fly-client-ip': '203.0.113.7' },
    body: JSON.stringify({ fal: 'short' }),
  });
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: 'bad_key', provider: 'fal' });
  expect(res.headers.get('set-cookie')).toBeNull();
});

it('ignores a provider it does not know', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'video-keys-'));
  const app = appFor(dir);
  const res = await app.request('/api/video-keys', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'fly-client-ip': '203.0.113.7' },
    body: JSON.stringify({ clear: ['higgsfield'] }),
  });
  expect(res.status).toBe(400);
});

it('removes the saved key and clears the cookie', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'video-keys-'));
  const app = appFor(dir);
  const headers = { 'content-type': 'application/json', 'fly-client-ip': '203.0.113.7' };
  const saved = await app.request('/api/video-keys', { method: 'PUT', headers, body: JSON.stringify({ fal: FAL }) });
  const cookie = cookieFrom(saved);
  const cleared = await app.request('/api/video-keys', { method: 'PUT', headers: { ...headers, cookie }, body: JSON.stringify({ clear: ['fal'] }) });
  expect(await cleared.json()).toEqual({ fal: false });
  const after = await app.request('/api/video-keys', { headers: { cookie, 'fly-client-ip': '203.0.113.7' } });
  expect(await after.json()).toEqual({ fal: false });
});
