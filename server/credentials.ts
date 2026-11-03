// Which Muse key a request spends. A Director code uses the server key. A visitor's own key is used otherwise,
// and is kept on disk only so a film can finish after the request that started it (a queue slot, or a restart).
import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import { MUSE_KEY_HEADER, PASSCODE_HEADER } from '@shared/api';
import { loadEnv, type Env } from './env';

export type KeySource = 'code' | 'user' | 'server';

export interface Access {
  source: KeySource;
  /** The key Meta calls should send. Undefined when this server has no key for that source. */
  key: string | undefined;
}

const current = new AsyncLocalStorage<Access>();
const FILM_ID = /^[A-Za-z0-9_-]{1,80}$/;

const same = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** True only when a code is configured and the header or bearer matches it. An unset code does not match. */
export function codeMatches(headers: Headers, passcode: string | undefined): boolean {
  if (!passcode) return false;
  const direct = headers.get(PASSCODE_HEADER);
  if (direct !== null && same(direct, passcode)) return true;
  const bearer = headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  return bearer !== undefined && same(bearer.trim(), passcode);
}

/** A visitor key from the settings header. Empty and short values are ignored. */
export function readUserKey(headers: Headers): string | undefined {
  const raw = headers.get(MUSE_KEY_HEADER);
  if (raw == null) return undefined;
  const key = raw.trim();
  if (key.length < 12 || key.length > 300 || /\s/.test(key)) return undefined;
  return key;
}

/**
 * Code first: a matching Director code spends the server key.
 * Otherwise a visitor key, if they sent one.
 * Otherwise, when no code is configured (local), the server key.
 * When a code is configured and they sent neither, the request is refused.
 */
export function resolveAccess(headers: Headers, env: Env): { ok: true; access: Access } | { ok: false } {
  // LOCALHOST_RUN: the owner is on their own machine, so no code or visitor key is needed. A key the page sends still wins.
  if (env.LOCALHOST_RUN) {
    const own = readUserKey(headers);
    return { ok: true, access: own ? { source: 'user', key: own } : { source: 'server', key: env.metaApiKey } };
  }
  if (codeMatches(headers, env.DIRECTOR_PASSCODE)) return { ok: true, access: { source: 'code', key: env.metaApiKey } };
  const own = readUserKey(headers);
  if (own) return { ok: true, access: { source: 'user', key: own } };
  if (!env.DIRECTOR_PASSCODE) return { ok: true, access: { source: 'server', key: env.metaApiKey } };
  return { ok: false };
}

export function runWithAccess<T>(access: Access, fn: () => T): T {
  return current.run(access, fn);
}

/** The key for Meta calls in this async chain, or the fallback (the process key) when nothing else is set. */
export function activeMuseKey(fallback?: string): string | undefined {
  return current.getStore()?.key ?? fallback;
}

function keyFile(dataDir: string, filmId: string): string | undefined {
  if (!FILM_ID.test(filmId)) return undefined;
  return join(dataDir, 'secrets', `${filmId}.key`);
}

/** Remember a visitor key for this film. A code or the server key is not written down. */
export function rememberUserKey(dataDir: string, filmId: string): void {
  const access = current.getStore();
  if (access?.source !== 'user' || !access.key) return;
  const path = keyFile(dataDir, filmId);
  if (!path) return;
  mkdirSync(join(dataDir, 'secrets'), { recursive: true, mode: 0o700 });
  writeFileSync(path, access.key, { mode: 0o600 });
}

function savedUserKey(dataDir: string, filmId: string): string | undefined {
  const path = keyFile(dataDir, filmId);
  if (!path) return undefined;
  try {
    const key = readFileSync(path, 'utf8').trim();
    if (key.length < 12 || /\s/.test(key)) return undefined;
    return key;
  } catch {
    return undefined;
  }
}

/**
 * Run film work with the right key. A request already in flight keeps its own key.
 * A queued or restarted film uses the visitor key saved for it, then the server key.
 */
export function runWithFilmKey<T>(dataDir: string, filmId: string, fn: () => T): T {
  if (current.getStore()) return fn();
  const saved = savedUserKey(dataDir, filmId);
  if (saved) return current.run({ source: 'user', key: saved }, fn);
  return current.run({ source: 'server', key: loadEnv().metaApiKey }, fn);
}
