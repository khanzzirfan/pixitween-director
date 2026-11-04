// Visitor video keys. The Muse passcode does not apply here.
// A key saved on one IP is not readable, and not spendable, from another.
import type { Context, Hono } from 'hono';
import { VIDEO_PROVIDERS, type VideoKeyUpdate, type VideoProvider } from '@shared/api';
import { loadEnv } from '../../env';
import { clientIp } from '../client-ip';
import {
  clearVideoSessionCookie,
  deleteVideoSession,
  keyStatus,
  openVideoSession,
  saveVideoSession,
  validateUpdate,
  videoSessionCookie,
} from '../../video/session';

const empty = { fal: false };

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

export function registerVideoRoutes(app: Hono, deps: { dataDir?: () => string } = {}): void {
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
}
