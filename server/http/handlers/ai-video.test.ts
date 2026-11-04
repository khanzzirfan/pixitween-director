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

const IP = { 'fly-client-ip': '203.0.113.7' };

/** An app with a film, and the headers of a visitor who has saved a Fal key (`key: false` for one who has not). */
async function appFor(fal = fakeFal(), film: unknown = { id: FILM, title: 'Towel', composition: towelFilm({ count: 2, sec: 3 }) }, key = true) {
  const photo = await sharp({ create: { width: 400, height: 300, channels: 3, background: '#2a6f97' } }).png().toBuffer();
  const dir = mkdtempSync(join(tmpdir(), 'ai-video-'));
  const deps = {
    films: { get: async () => { if (film === null) throw new Error('missing'); return film; } },
    assets: { read: async () => photo },
  } as unknown as AppDeps;
  const app = new Hono();
  registerAiVideoRoutes(app, deps, { dataDir: () => dir, fetchImpl: fal.fetchImpl });
  const session = key ? saveVideoSession(dir, undefined, '203.0.113.7', { fal: OWN_KEY }, true) : undefined;
  if (session && 'error' in session) throw new Error('session not saved');
  const h = { ...IP, ...(session ? { cookie: `mr_video=${session.id}` } : {}) };
  return { app, dir, fal, h };
}

type Rig = Awaited<ReturnType<typeof appFor>>;
const post = (r: Rig, body: unknown = { resolution: '480P' }, headers: Record<string, string> = r.h) =>
  r.app.request(`/api/films/${FILM}/ai-video`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const quote = async (r: Rig, resolution = '480P', headers: Record<string, string> = r.h) => (await r.app.request(`/api/films/${FILM}/ai-video/quote?resolution=${resolution}`, { headers })).json();

beforeEach(() => {
  process.env.TRUST_FLY_CLIENT_IP = 'true';
  delete process.env.IS_SERVER;
  delete process.env.DIRECTOR_PASSCODE;
});
afterEach(() => {
  process.env = { ...saved };
});

it('quotes the movie before anything is spent, and says whether the visitor has a Fal key', async () => {
  const withKey = await appFor();
  expect(await quote(withKey, '768P')).toEqual({ resolution: '768P', durationSec: 6, filmSec: 6, costUsd: 0.48, frames: 2, skippedScenes: [], keyReady: true });
  expect(withKey.fal.calls).toHaveLength(0);

  const without = await appFor(undefined, undefined, false);
  expect((await quote(without)).keyReady).toBe(false);
});

it('refuses a film that is missing, empty or has no pictures, and a resolution it does not offer', async () => {
  const missing = await appFor(undefined, null);
  expect((await missing.app.request(`/api/films/${FILM}/ai-video/quote`, { headers: missing.h })).status).toBe(404);
  const empty = await appFor(undefined, { id: FILM, composition: { fps: 30, durationInFrames: 0 } });
  expect((await empty.app.request(`/api/films/${FILM}/ai-video/quote`, { headers: empty.h })).status).toBe(409);
  const bare = await appFor(undefined, { id: FILM, title: 'x', composition: towelFilm({ count: 0, bare: 2 }) });
  const res = await bare.app.request(`/api/films/${FILM}/ai-video/quote`, { headers: bare.h });
  expect(res.status).toBe(409);
  expect((await res.json()).error).toBe('no_frames');
  const ok = await appFor();
  expect((await ok.app.request(`/api/films/${FILM}/ai-video/quote?resolution=4K`, { headers: ok.h })).status).toBe(400);
  expect((await post(ok, { resolution: '4K' })).status).toBe(400);
});

it("uploads one frame per shot, submits the H3 request with the visitor's key and records the job", async () => {
  const rig = await appFor();
  const res = await post(rig, { resolution: '768P' });
  expect(res.status).toBe(202);
  const job = await res.json();
  expect(job).toMatchObject({ filmId: FILM, status: 'queued', resolution: '768P', durationSec: 6, costUsd: 0.48 });
  expect(JSON.stringify(job)).not.toContain(OWN_KEY);

  const { calls } = rig.fal;
  expect(calls.filter((c) => c.url.includes('/storage/upload/initiate'))).toHaveLength(2);
  expect(calls.filter((c) => c.method !== 'PUT').every((c) => c.auth === `Key ${OWN_KEY}`)).toBe(true);
  const submit = calls.find((c) => c.url === 'https://queue.fal.run/minimax/h3-max/reference-to-video')!;
  const input = JSON.parse(submit.body!);
  expect(input).toMatchObject({ duration: 6, resolution: '768P', aspect_ratio: '9:16', reference_image_urls: ['https://v3.fal.media/f/1.jpg', 'https://v3.fal.media/f/2.jpg'] });
  expect(input.prompt).toContain('Shot 2');
});

it('follows the job from the queue to a finished video and serves the file from this origin', async () => {
  const state = { status: 'IN_QUEUE', queuePosition: 3 };
  const rig = await appFor(fakeFal(state));
  const job = await (await post(rig)).json();
  const poll = async () => (await rig.app.request(`/api/ai-videos/${job.id}`, { headers: rig.h })).json();

  expect(await poll()).toMatchObject({ status: 'queued', queuePosition: 3 });
  state.status = 'IN_PROGRESS';
  expect(await poll()).toMatchObject({ status: 'running' });
  state.status = 'COMPLETED';
  const done = await poll();
  expect(done).toMatchObject({ status: 'succeeded', videoUrl: `/api/ai-videos/${job.id}/download` });
  expect(JSON.stringify(done)).not.toContain('fal.media');

  const file = await rig.app.request(done.videoUrl, { headers: rig.h });
  expect(file.headers.get('content-type')).toBe('video/mp4');
  expect(await file.text()).toBe('mp4-bytes');
});

it('reports a failed run and a run that finished with no video', async () => {
  const failing = await appFor(fakeFal({ status: 'FAILED' }));
  const a = await (await post(failing)).json();
  expect(await (await failing.app.request(`/api/ai-videos/${a.id}`, { headers: failing.h })).json()).toMatchObject({ status: 'failed' });

  const empty = await appFor(fakeFal({ status: 'COMPLETED', video: null }));
  const b = await (await post(empty)).json();
  expect(await (await empty.app.request(`/api/ai-videos/${b.id}`, { headers: empty.h })).json()).toMatchObject({ status: 'failed', error: 'Fal finished without a video.' });
});

it('will not proxy a video from a host that is not Fal', async () => {
  const rig = await appFor(fakeFal({ status: 'COMPLETED', video: 'https://evil.example/out.mp4' }));
  const job = await (await post(rig)).json();
  expect((await rig.app.request(`/api/ai-videos/${job.id}/download`, { headers: rig.h })).status).toBe(404);
});

it('starts nothing, and calls Fal nowhere, when the visitor has no key', async () => {
  const rig = await appFor(undefined, undefined, false);
  const res = await post(rig);
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: 'video_key_missing' });
  expect(rig.fal.calls).toHaveLength(0);
});

it('never spends a Fal key from the server environment, even a Director code holder or a local run', async () => {
  process.env.FAL_API_KEY = 'fal-server-key-1234567890';
  process.env.DIRECTOR_PASSCODE = 'studio-code';
  const rig = await appFor(undefined, undefined, false);
  const headers = { ...IP, 'x-director-passcode': 'studio-code' };
  expect((await quote(rig, '480P', headers)).keyReady).toBe(false);
  const res = await post(rig, { resolution: '480P' }, headers);
  expect(res.status).toBe(409);
  expect(rig.fal.calls).toHaveLength(0);
});

it('spends the key only from the session and network that saved it', async () => {
  const rig = await appFor();
  const job = await (await post(rig)).json();

  const elsewhere = await rig.app.request(`/api/ai-videos/${job.id}`, { headers: { ...rig.h, 'fly-client-ip': '198.51.100.4' } });
  expect(elsewhere.status).toBe(403);
  const noCookie = await rig.app.request(`/api/ai-videos/${job.id}`, { headers: IP });
  expect(noCookie.status).toBe(409);

  const other = saveVideoSession(rig.dir, undefined, '203.0.113.7', { fal: 'another-fal-key-1234567' }, true);
  if ('error' in other) throw new Error('session not saved');
  const stranger = await rig.app.request(`/api/ai-videos/${job.id}`, { headers: { ...IP, cookie: `mr_video=${other.id}` } });
  expect(stranger.status).toBe(409);
});

it("shows Fal's own refusal, such as an empty balance, without the key", async () => {
  const fetchImpl: typeof fetch = async (input) => {
    if (String(input).includes('/storage/upload/initiate')) return new Response(JSON.stringify({ detail: 'Exhausted balance. Top up at fal.ai/dashboard/billing.' }), { status: 403 });
    return new Response('{}', { status: 200 });
  };
  const rig = await appFor({ fetchImpl, calls: [] });
  const res = await post(rig);
  expect(res.status).toBe(403);
  const body = await res.json();
  expect(body.message).toContain('Exhausted balance');
  expect(JSON.stringify(body)).not.toContain(OWN_KEY);
});
