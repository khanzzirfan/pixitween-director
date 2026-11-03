// Visitor video keys and the reels they pay for. The Muse passcode does not apply here.
// A key saved on one IP is not readable, and not spendable, from another.
import type { Context, Hono } from 'hono';
import { VIDEO_PROVIDERS, type VideoCreateRequest, type VideoJobResponse, type VideoKeyUpdate, type VideoProvider } from '@shared/api';
import { loadEnv } from '../../env';
import { clientIp } from '../client-ip';
import { createJobId, readJob, writeJob, type VideoJob } from '../../video/jobs';
import { pollReel, providerFailure, startReel } from '../../video/reel';
import {
  clearVideoSessionCookie,
  deleteVideoSession,
  hashIp,
  ipMatches,
  keyStatus,
  openVideoSession,
  saveVideoSession,
  validateUpdate,
  videoSessionCookie,
} from '../../video/session';

const empty = { fal: false, higgsfield: false, revana: false };

function secureCookie(c: Context): boolean {
  return c.req.header('x-forwarded-proto') === 'https' || new URL(c.req.url).protocol === 'https:';
}

function isProvider(value: string): value is VideoProvider {
  return (VIDEO_PROVIDERS as readonly string[]).includes(value);
}

function readUpdate(body: unknown): VideoKeyUpdate | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const raw = body as VideoKeyUpdate;
  const update: VideoKeyUpdate = {};
  for (const provider of VIDEO_PROVIDERS) {
    const value = raw[provider];
    if (value === undefined) continue;
    if (typeof value !== 'string') return undefined;
    update[provider] = value;
  }
  if (raw.clear !== undefined) {
    if (!Array.isArray(raw.clear) || raw.clear.some((name) => typeof name !== 'string' || !isProvider(name))) return undefined;
    update.clear = raw.clear;
  }
  return update;
}

function readReel(body: unknown): VideoCreateRequest | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const raw = body as VideoCreateRequest;
  if (typeof raw.provider !== 'string' || !isProvider(raw.provider)) return undefined;
  if (typeof raw.prompt !== 'string' || raw.prompt.trim().length < 1 || raw.prompt.length > 4_000) return undefined;
  if (raw.imageUrl !== undefined && (typeof raw.imageUrl !== 'string' || !/^https:\/\//.test(raw.imageUrl))) return undefined;
  if (raw.duration !== undefined && (!Number.isInteger(raw.duration) || raw.duration < 2 || raw.duration > 30)) return undefined;
  return { provider: raw.provider, prompt: raw.prompt.trim(), ...(raw.imageUrl ? { imageUrl: raw.imageUrl } : {}), ...(raw.duration !== undefined ? { duration: raw.duration } : {}) };
}

export function registerVideoRoutes(app: Hono, deps: { dataDir?: () => string; fetchImpl?: typeof fetch } = {}): void {
  const dataDir = () => deps.dataDir?.() ?? loadEnv().DATA_DIR;

  app.get('/api/video-keys', (c) => {
    const opened = openVideoSession(dataDir(), c.req.header('cookie'), clientIp(c));
    if (!opened.ok) return opened.error === 'ip_locked' ? c.json({ error: 'ip_locked' }, 403) : c.json(empty);
    return c.json(keyStatus(opened.session.keys));
  });

  app.put('/api/video-keys', async (c) => {
    const update = readUpdate(await c.req.json().catch(() => null));
    if (!update) return c.json({ error: 'bad_request' }, 400);
    const bad = validateUpdate(update);
    if (bad) return c.json({ error: 'bad_key', provider: bad }, 400);
    const fresh = c.req.query('fresh') === '1';
    const saved = saveVideoSession(dataDir(), c.req.header('cookie'), clientIp(c), update, fresh);
    if ('error' in saved) return c.json({ error: 'ip_locked' }, 403);
    const secure = secureCookie(c);
    c.header('Set-Cookie', saved.empty ? clearVideoSessionCookie(secure) : videoSessionCookie(saved.id, secure));
    return c.json(saved.status);
  });

  app.delete('/api/video-keys', (c) => {
    const secure = secureCookie(c);
    if (c.req.query('fresh') === '1') {
      c.header('Set-Cookie', clearVideoSessionCookie(secure));
      return c.json(empty);
    }
    const removed = deleteVideoSession(dataDir(), c.req.header('cookie'), clientIp(c));
    if (!removed.ok) return c.json({ error: 'ip_locked' }, 403);
    c.header('Set-Cookie', clearVideoSessionCookie(secure));
    return c.json(empty);
  });

  app.post('/api/videos', async (c) => {
    const reel = readReel(await c.req.json().catch(() => null));
    if (!reel) return c.json({ error: 'bad_request' }, 400);
    const opened = openVideoSession(dataDir(), c.req.header('cookie'), clientIp(c));
    if (!opened.ok) return c.json({ error: opened.error === 'ip_locked' ? 'ip_locked' : 'video_key_missing' }, opened.error === 'ip_locked' ? 403 : 409);
    try {
      const remote = await startReel(opened.session.keys, reel, { fetchImpl: deps.fetchImpl });
      const job: VideoJob = {
        id: createJobId(),
        provider: reel.provider,
        sessionId: opened.session.id,
        ipHash: hashIp(clientIp(c)),
        createdAt: new Date().toISOString(),
        ...remote,
      };
      writeJob(dataDir(), job);
      const body: VideoJobResponse = { id: job.id, provider: job.provider, status: 'queued' };
      return c.json(body, 202);
    } catch (error) {
      const failed = providerFailure(error);
      return c.json({ error: failed.error, ...(failed.message ? { message: failed.message } : {}) }, failed.status as 400);
    }
  });

  app.get('/api/videos/:id', async (c) => {
    const job = readJob(dataDir(), c.req.param('id'));
    const opened = openVideoSession(dataDir(), c.req.header('cookie'), clientIp(c));
    if (!opened.ok) return c.json({ error: opened.error === 'ip_locked' ? 'ip_locked' : 'not_found' }, opened.error === 'ip_locked' ? 403 : 404);
    if (!job || job.sessionId !== opened.session.id) return c.json({ error: 'not_found' }, 404);
    if (!ipMatches(job.ipHash, clientIp(c))) return c.json({ error: 'ip_locked' }, 403);
    try {
      const polled = await pollReel(opened.session.keys, job.provider, job, { fetchImpl: deps.fetchImpl });
      const body: VideoJobResponse = { id: job.id, provider: job.provider, ...polled };
      return c.json(body);
    } catch (error) {
      const failed = providerFailure(error);
      return c.json({ error: failed.error, ...(failed.message ? { message: failed.message } : {}) }, failed.status as 400);
    }
  });
}
