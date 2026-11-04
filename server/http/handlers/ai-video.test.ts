import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import sharp from 'sharp';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { towelFilm } from '../../authoring/test-helpers';
import { saveVideoSession } from '../../video/session';
import type { AppDeps } from '../deps';
import { registerAiVideoRoutes } from './ai-video';

const ENV_KEY = 'fal-env-key-1234567890';
const OWN_KEY = 'fal-own-key-1234567890';
const FILM = 'film_aaaaaaaaaaaa';
const saved = { ...process.env };

interface Call {
  method: string;
  url: string;
  auth: string | null;
  body?: string;
}

/** A stand-in for Fal: storage, the queue, a status that follows `state.status`, and the CDN file. */
function fakeFal(state: { status: string; queuePosition?: number; video?: string | null } = { status: 'IN_QUEUE' }) {
  const calls: Call[] = [];
  let uploads = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ method, url, auth: new Headers(init?.headers).get('authorization'), ...(typeof init?.body === 'string' ? { body: init.body } : {}) });
    if (url.includes('/storage/upload/initiate')) {
      uploads += 1;
      return new Response(JSON.stringify({ upload_url: `https://v3.fal.media/up/${uploads}`, file_url: `https://v3.fal.media/f/${uploads}.jpg` }), { status: 200 });
    }
    if (method === 'PUT') return new Response(null, { status: 200 });
    if (method === 'POST' && url.startsWith('https://queue.fal.run/')) {
      return new Response(JSON.stringify({ request_id: 'req_1', status_url: 'https://queue.fal.run/minimax/h3-max/requests/req_1/status', response_url: 'https://queue.fal.run/minimax/h3-max/requests/req_1' }), { status: 200 });
    }
    if (url.endsWith('/status')) return new Response(JSON.stringify({ status: state.status, ...(state.queuePosition !== undefined ? { queue_position: state.queuePosition } : {}) }), { status: 200 });
    if (url.startsWith('https://queue.fal.run/')) return new Response(JSON.stringify(state.video === null ? {} : { video: { url: state.video ?? 'https://v3.fal.media/out.mp4' } }), { status: 200 });
    if (url.endsWith('/out.mp4')) return new Response('mp4-bytes', { status: 200 });
    return new Response('unexpected', { status: 500 });
  };
  return { fetchImpl, calls };
}

async function appFor(fal = fakeFal(), film: unknown = { id: FILM, title: 'Towel', composition: towelFilm({ count: 2, sec: 3 }) }) {
  const photo = await sharp({ create: { width: 400, height: 300, channels: 3, background: '#2a6f97' } }).png().toBuffer();
  const dir = mkdtempSync(join(tmpdir(), 'ai-video-'));
  const deps = {
    films: { get: async () => { if (film === null) throw new Error('missing'); return film; } },
    assets: { read: async () => photo },
  } as unknown as AppDeps;
  const app = new Hono();
  registerAiVideoRoutes(app, deps, { dataDir: () => dir, fetchImpl: fal.fetchImpl });
  return { app, dir, fal };
}

const IP = { 'fly-client-ip': '203.0.113.7' };
const post = (app: Hono, body: unknown = { resolution: '480P' }, headers: Record<string, string> = {}) =>
  app.request(`/api/films/${FILM}/ai-video`, { method: 'POST', headers: { 'content-type': 'application/json', ...IP, ...headers }, body: JSON.stringify(body) });

beforeEach(() => {
  process.env.TRUST_FLY_CLIENT_IP = 'true';
  process.env.FAL_API_KEY = ENV_KEY;
  delete process.env.IS_SERVER;
  delete process.env.DIRECTOR_PASSCODE;
});
afterEach(() => {
  process.env = { ...saved };
});

it('quotes the movie before anything is spent, and says whether a key is ready', async () => {
  const { app, fal } = await appFor();
  const res = await app.request(`/api/films/${FILM}/ai-video/quote?resolution=768P`, { headers: IP });
  expect(await res.json()).toEqual({ resolution: '768P', durationSec: 6, filmSec: 6, costUsd: 0.48, frames: 2, skippedScenes: [], keyReady: true });
  expect(fal.calls).toHaveLength(0);

  delete process.env.FAL_API_KEY;
  const none = await app.request(`/api/films/${FILM}/ai-video/quote`, { headers: IP });
  expect((await none.json()).keyReady).toBe(false);
});

it('refuses a film that is missing, empty or has no pictures, and a resolution it does not offer', async () => {
  expect((await (await appFor(undefined, null)).app.request(`/api/films/${FILM}/ai-video/quote`)).status).toBe(404);
  expect((await (await appFor(undefined, { id: FILM, composition: { fps: 30, durationInFrames: 0 } })).app.request(`/api/films/${FILM}/ai-video/quote`)).status).toBe(409);
  const bare = await appFor(undefined, { id: FILM, title: 'x', composition: towelFilm({ count: 0, bare: 2 }) });
  const res = await bare.app.request(`/api/films/${FILM}/ai-video/quote`);
  expect(res.status).toBe(409);
  expect((await res.json()).error).toBe('no_frames');
  expect((await (await appFor()).app.request(`/api/films/${FILM}/ai-video/quote?resolution=4K`)).status).toBe(400);
  expect((await post((await appFor()).app, { resolution: '4K' })).status).toBe(400);
});

it('uploads one frame per shot, submits the H3 request with the key and records the job', async () => {
  const { app, fal } = await appFor();
  const res = await post(app, { resolution: '768P' });
  expect(res.status).toBe(202);
  const job = await res.json();
  expect(job).toMatchObject({ filmId: FILM, status: 'queued', resolution: '768P', durationSec: 6, costUsd: 0.48 });
  expect(JSON.stringify(job)).not.toContain(ENV_KEY);

  expect(fal.calls.filter((c) => c.url.includes('/storage/upload/initiate'))).toHaveLength(2);
  expect(fal.calls.every((c) => c.method === 'PUT' || c.auth === `Key ${ENV_KEY}`)).toBe(true);
  const submit = fal.calls.find((c) => c.url === 'https://queue.fal.run/minimax/h3-max/reference-to-video')!;
  const input = JSON.parse(submit.body!);
  expect(input).toMatchObject({ duration: 6, resolution: '768P', aspect_ratio: '9:16', reference_image_urls: ['https://v3.fal.media/f/1.jpg', 'https://v3.fal.media/f/2.jpg'] });
  expect(input.prompt).toContain('Shot 2');
});

it('follows the job from the queue to a finished video and serves the file from this origin', async () => {
  const state = { status: 'IN_QUEUE', queuePosition: 3 };
  const { app } = await appFor(fakeFal(state));
  const job = await (await post(app)).json();
  const poll = async () => (await app.request(`/api/ai-videos/${job.id}`, { headers: IP })).json();

  expect(await poll()).toMatchObject({ status: 'queued', queuePosition: 3 });
  state.status = 'IN_PROGRESS';
  expect(await poll()).toMatchObject({ status: 'running' });
  state.status = 'COMPLETED';
  const done = await poll();
  expect(done).toMatchObject({ status: 'succeeded', videoUrl: `/api/ai-videos/${job.id}/download` });
  expect(JSON.stringify(done)).not.toContain('fal.media');

  const file = await app.request(done.videoUrl, { headers: IP });
  expect(file.headers.get('content-type')).toBe('video/mp4');
  expect(await file.text()).toBe('mp4-bytes');
});

it('reports a failed run and a run that finished with no video', async () => {
  const failing = await appFor(fakeFal({ status: 'FAILED' }));
  const a = await (await post(failing.app)).json();
  expect(await (await failing.app.request(`/api/ai-videos/${a.id}`, { headers: IP })).json()).toMatchObject({ status: 'failed' });

  const empty = await appFor(fakeFal({ status: 'COMPLETED', video: null }));
  const b = await (await post(empty.app)).json();
  expect(await (await empty.app.request(`/api/ai-videos/${b.id}`, { headers: IP })).json()).toMatchObject({ status: 'failed', error: 'Fal finished without a video.' });
});

it('will not proxy a video from a host that is not Fal', async () => {
  const { app } = await appFor(fakeFal({ status: 'COMPLETED', video: 'https://evil.example/out.mp4' }));
  const job = await (await post(app)).json();
  expect((await app.request(`/api/ai-videos/${job.id}/download`, { headers: IP })).status).toBe(404);
});

it('starts nothing, and calls Fal nowhere, when no key can pay', async () => {
  delete process.env.FAL_API_KEY;
  const { app, fal } = await appFor();
  const res = await post(app);
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: 'video_key_missing' });
  expect(fal.calls).toHaveLength(0);
});

it('spends the visitor key in preference to the server key, and only from the network that saved it', async () => {
  const { app, dir, fal } = await appFor();
  const session = saveVideoSession(dir, undefined, '203.0.113.7', { fal: OWN_KEY }, true);
  if ('error' in session) throw new Error('session not saved');
  const cookie = `mr_video=${session.id}`;

  const res = await post(app, { resolution: '480P' }, { cookie });
  expect(res.status).toBe(202);
  const job = await res.json();
  expect(fal.calls.filter((c) => c.method !== 'PUT').every((c) => c.auth === `Key ${OWN_KEY}`)).toBe(true);

  const elsewhere = await app.request(`/api/ai-videos/${job.id}`, { headers: { cookie, 'fly-client-ip': '198.51.100.4' } });
  expect(elsewhere.status).toBe(403);
  const noCookie = await app.request(`/api/ai-videos/${job.id}`, { headers: IP });
  expect(noCookie.status).toBe(409);
});

it('on a deployed host the server key pays only for a Director code', async () => {
  process.env.IS_SERVER = 'true';
  process.env.DIRECTOR_PASSCODE = 'studio-code';
  process.env.META_API_KEY = 'meta-key-1234567890';
  const { app } = await appFor();
  const quote = async (headers: Record<string, string>) => (await app.request(`/api/films/${FILM}/ai-video/quote`, { headers: { ...IP, ...headers } })).json();
  expect((await quote({})).keyReady).toBe(false);
  expect((await quote({ 'x-director-passcode': 'wrong' })).keyReady).toBe(false);
  expect((await quote({ 'x-director-passcode': 'studio-code' })).keyReady).toBe(true);
});

it('shows Fal\'s own refusal, such as an empty balance, without the key', async () => {
  const fetchImpl: typeof fetch = async (input) => {
    if (String(input).includes('/storage/upload/initiate')) return new Response(JSON.stringify({ detail: 'Exhausted balance. Top up at fal.ai/dashboard/billing.' }), { status: 403 });
    return new Response('{}', { status: 200 });
  };
  const { app } = await appFor({ fetchImpl, calls: [] });
  const res = await post(app);
  expect(res.status).toBe(403);
  const body = await res.json();
  expect(body.message).toContain('Exhausted balance');
  expect(JSON.stringify(body)).not.toContain(ENV_KEY);
});
