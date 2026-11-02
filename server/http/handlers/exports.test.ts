import { existsSync, readdirSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import sharp from 'sharp';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp } from '../app';
import { makeTestDeps } from '../../test-utils/deps';
import type { AppDeps } from '../deps';
import { hasFfmpeg, probeVideo } from '../../media/ffmpeg';
import { registerExportRoutes, type ExportRouteOptions } from './exports';

let root: string;
const saved = { ...process.env };
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'exports-test-'));
});
afterEach(async () => {
  process.env = { ...saved };
  await rm(root, { recursive: true, force: true });
});

const fakeEncode: NonNullable<ExportRouteOptions['encode']> = async (o) => void (await writeFile(o.out, Buffer.from('fake-mp4')));
const mk = (o: ExportRouteOptions = {}) => {
  const app = new Hono();
  registerExportRoutes(app, {} as AppDeps, { tmpRoot: root, encode: fakeEncode, check: vi.fn().mockResolvedValue([]), hasFfmpeg: async () => true, ...o });
  return app;
};
const start = (app: Hono, frames = 3) =>
  app.request('/api/exports', { method: 'POST', body: JSON.stringify({ fps: 30, frames, width: 64, height: 64 }), headers: { 'content-type': 'application/json' } });
const put = (app: Hono, id: string, i: number, body: BodyInit = 'jpg') => app.request(`/api/exports/${id}/frames/${i}`, { method: 'PUT', body });

it('runs start, frames and finish', async () => {
  const encode = vi.fn(fakeEncode);
  const app = mk({ encode });
  const res = await start(app);
  expect(res.status).toBe(201);
  const { id } = (await res.json()) as { id: string };
  for (let i = 0; i < 3; i++) expect((await put(app, id, i)).status).toBe(204);
  const done = await app.request(`/api/exports/${id}/finish`, { method: 'POST' });
  expect(done.status).toBe(200);
  expect(done.headers.get('content-type')).toBe('video/mp4');
  expect(done.headers.get('x-export-problems')).toBe('[]');
  expect(Buffer.from(await done.arrayBuffer()).toString()).toBe('fake-mp4');
  expect(encode).toHaveBeenCalledTimes(1);
  expect(readdirSync(root)).toEqual([]);
});

it('answers 409 with the missing frames, 404 for an unknown id and 429 when busy', async () => {
  const app = mk();
  const { id } = (await (await start(app)).json()) as { id: string };
  await put(app, id, 0);
  await put(app, id, 2);
  const fin = await app.request(`/api/exports/${id}/finish`, { method: 'POST' });
  expect(fin.status).toBe(409);
  expect(await fin.json()).toEqual({ error: 'missing_frames', missing: [1] });
  expect((await put(app, 'nope', 0)).status).toBe(404);
  expect((await app.request('/api/exports/nope/finish', { method: 'POST' })).status).toBe(404);
  expect((await start(app)).status).toBe(201);
  expect((await start(app)).status).toBe(429);
});

it('answers 503 on every route without ffmpeg', async () => {
  const app = mk({ hasFfmpeg: async () => false });
  for (const [m, p] of [['POST', '/api/exports'], ['PUT', '/api/exports/x/frames/0'], ['POST', '/api/exports/x/finish'], ['POST', '/api/exports/check']] as const) {
    const res = await app.request(p, { method: m, body: m === 'POST' ? '{}' : 'x' });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'ffmpeg_missing' });
  }
});

it('rejects a 5 MB frame with 413 and writes nothing', async () => {
  const app = mk();
  const { id } = (await (await start(app)).json()) as { id: string };
  const res = await put(app, id, 0, new Uint8Array(5 * 1024 * 1024));
  expect(res.status).toBe(413);
  expect(readdirSync(root).flatMap((d) => readdirSync(join(root, d)))).toEqual([]);
});

it('deletes the temp dir after a failed encode and after idle expiry', async () => {
  const failing = mk({ encode: async () => Promise.reject(new Error('x264 died')) });
  const { id } = (await (await start(failing, 1)).json()) as { id: string };
  await put(failing, id, 0);
  const res = await failing.request(`/api/exports/${id}/finish`, { method: 'POST' });
  expect(res.status).toBe(500);
  expect(readdirSync(root)).toEqual([]);

  let t = 0;
  const app = mk({ now: () => t });
  const first = (await (await start(app)).json()) as { id: string };
  expect(readdirSync(root)).toHaveLength(1);
  t = 11 * 60_000;
  expect((await put(app, first.id, 0)).status).toBe(404);
  expect(readdirSync(root)).toEqual([]);
});

it('checks an uploaded MP4', async () => {
  const check = vi.fn().mockResolvedValue(['frames 3, expected 5']);
  const app = mk({ check });
  const res = await app.request('/api/exports/check?durationSec=2&fps=30&width=64&height=64', { method: 'POST', body: 'mp4' });
  expect(await res.json()).toEqual({ problems: ['frames 3, expected 5'] });
  expect(check).toHaveBeenCalledWith(expect.any(Buffer), { durationSec: 2, fps: 30, width: 64, height: 64 });
  expect((await app.request('/api/exports/check', { method: 'POST', body: 'x' })).status).toBe(400);
});

it('asks for the passcode through the app middleware', async () => {
  process.env.DIRECTOR_PASSCODE = 'secret';
  const app = createApp(await makeTestDeps());
  const body = JSON.stringify({ fps: 30, frames: 1, width: 64, height: 64 });
  expect((await app.request('/api/exports', { method: 'POST', body })).status).toBe(401);
  expect((await app.request('/api/exports', { method: 'POST', body, headers: { 'x-director-passcode': 'secret' } })).status).not.toBe(401);
});

it.skipIf(!(await hasFfmpeg()))('encodes six uploaded JPEGs with the real ffmpeg', async () => {
  const app = new Hono();
  registerExportRoutes(app, {} as AppDeps, { tmpRoot: root });
  const res = await app.request('/api/exports', { method: 'POST', body: JSON.stringify({ fps: 6, frames: 6, width: 64, height: 64 }), headers: { 'content-type': 'application/json' } });
  const { id } = (await res.json()) as { id: string };
  for (let i = 0; i < 6; i++) {
    const jpg = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: i * 40, g: 255 - i * 40, b: 80 } } }).jpeg().toBuffer();
    expect((await put(app, id, i, new Uint8Array(jpg))).status).toBe(204);
  }
  const done = await app.request(`/api/exports/${id}/finish`, { method: 'POST' });
  expect(done.status).toBe(200);
  expect(await probeVideo(Buffer.from(await done.arrayBuffer()))).toMatchObject({ width: 64, height: 64, frames: 6 });
  expect(existsSync(root) && readdirSync(root)).toEqual([]);
});
