// A visitor's Fal key. The file is named by an HttpOnly cookie.
// The key is read back only when the request IP hashes to the same value that saved it.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { VIDEO_PROVIDERS, type VideoKeyStatus, type VideoKeyUpdate } from '@shared/api';

export const VIDEO_SESSION_COOKIE = 'mr_video';
const MAX_AGE_SEC = 12 * 60 * 60;
const ID = /^[a-f0-9]{64}$/;

export interface VideoSecrets {
  fal?: string;
}

interface SessionRecord {
  ipHash: string;
  keys: VideoSecrets;
  updatedAt: string;
}

export interface OpenSession {
  id: string;
  keys: VideoSecrets;
}

export type SessionLookup = { ok: true; session: OpenSession } | { ok: false; error: 'missing' | 'ip_locked' };

const same = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export const hashIp = (ip: string): string => createHash('sha256').update(`video-session:${ip}`).digest('hex');

export function ipMatches(ipHash: string, ip: string): boolean {
  return same(ipHash, hashIp(ip));
}

export function readCookie(header: string | undefined, name = VIDEO_SESSION_COOKIE): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const cut = part.indexOf('=');
    if (cut < 0) continue;
    if (part.slice(0, cut).trim() !== name) continue;
    const value = decodeURIComponent(part.slice(cut + 1).trim());
    return ID.test(value) ? value : undefined;
  }
  return undefined;
}

export function videoSessionCookie(id: string, secure: boolean, maxAge = MAX_AGE_SEC): string {
  const bits = [`${VIDEO_SESSION_COOKIE}=${id}`, 'HttpOnly', 'SameSite=Lax', 'Path=/', `Max-Age=${maxAge}`];
  if (secure) bits.push('Secure');
  return bits.join('; ');
}

export function clearVideoSessionCookie(secure: boolean): string {
  const bits = [`${VIDEO_SESSION_COOKIE}=`, 'HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=0'];
  if (secure) bits.push('Secure');
  return bits.join('; ');
}

export function keyStatus(keys: VideoSecrets): VideoKeyStatus {
  return { fal: Boolean(keys.fal) };
}

/** A reason the pasted value cannot be stored, or undefined when it is acceptable. The value is never included. */
export function rejectKey(value: string): string | undefined {
  const key = value.trim();
  if (/\s/.test(key)) return 'bad_key';
  if (key.length < 16 || key.length > 400) return 'bad_key';
  return undefined;
}

function folder(dataDir: string): string {
  return join(dataDir, 'video-sessions');
}

function pathFor(dataDir: string, id: string): string | undefined {
  if (!ID.test(id)) return undefined;
  return join(folder(dataDir), `${id}.json`);
}

function readRecord(dataDir: string, id: string): SessionRecord | undefined {
  const path = pathFor(dataDir, id);
  if (!path) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as SessionRecord;
    if (!parsed || typeof parsed.ipHash !== 'string' || !parsed.keys) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function writeRecord(dataDir: string, id: string, record: SessionRecord): void {
  const path = pathFor(dataDir, id);
  if (!path) return;
  mkdirSync(folder(dataDir), { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(record), { mode: 0o600 });
}

function live(record: SessionRecord): boolean {
  const at = Date.parse(record.updatedAt);
  return Number.isFinite(at) && Date.now() - at < MAX_AGE_SEC * 1000;
}

/** The keys for this cookie, or a refusal when the IP is not the one that saved them. */
export function openVideoSession(dataDir: string, cookieHeader: string | undefined, ip: string): SessionLookup {
  const id = readCookie(cookieHeader);
  if (!id) return { ok: false, error: 'missing' };
  const record = readRecord(dataDir, id);
  if (!record || !live(record)) return { ok: false, error: 'missing' };
  if (!same(record.ipHash, hashIp(ip))) return { ok: false, error: 'ip_locked' };
  return { ok: true, session: { id, keys: record.keys } };
}

function apply(keys: VideoSecrets, update: VideoKeyUpdate): VideoSecrets {
  const next: VideoSecrets = { ...keys };
  for (const provider of update.clear ?? []) {
    if (VIDEO_PROVIDERS.includes(provider)) delete next[provider];
  }
  for (const provider of VIDEO_PROVIDERS) {
    const value = update[provider];
    if (value === undefined) continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    next[provider] = trimmed;
  }
  return next;
}

export function validateUpdate(update: VideoKeyUpdate): string | undefined {
  for (const provider of VIDEO_PROVIDERS) {
    const value = update[provider];
    if (value === undefined || !value.trim()) continue;
    if (rejectKey(value)) return provider;
  }
  for (const provider of update.clear ?? []) {
    if (!VIDEO_PROVIDERS.includes(provider)) return provider;
  }
  return undefined;
}

export interface SavedSession {
  id: string;
  status: VideoKeyStatus;
  /** Set when every key was removed, so the cookie should be cleared. */
  empty: boolean;
}

/** Save keys for this IP. A cookie from another IP is refused unless `fresh` starts a new session. */
export function saveVideoSession(dataDir: string, cookieHeader: string | undefined, ip: string, update: VideoKeyUpdate, fresh: boolean): SavedSession | { error: 'ip_locked' } {
  const existingId = fresh ? undefined : readCookie(cookieHeader);
  const existing = existingId ? readRecord(dataDir, existingId) : undefined;
  if (existing && live(existing) && !same(existing.ipHash, hashIp(ip))) return { error: 'ip_locked' };
  const id = existing && same(existing.ipHash, hashIp(ip)) ? existingId! : randomBytes(32).toString('hex');
  const keys = apply(existing && id === existingId ? existing.keys : {}, update);
  const empty = !keys.fal;
  if (empty) {
    const path = pathFor(dataDir, id);
    if (path) rmSync(path, { force: true });
    return { id, status: keyStatus(keys), empty: true };
  }
  writeRecord(dataDir, id, { ipHash: hashIp(ip), keys, updatedAt: new Date().toISOString() });
  return { id, status: keyStatus(keys), empty: false };
}

/** Drop the session file when the IP matches. A mismatched IP does not get to delete someone else's keys. */
export function deleteVideoSession(dataDir: string, cookieHeader: string | undefined, ip: string): { ok: true } | { ok: false; error: 'ip_locked' } {
  const id = readCookie(cookieHeader);
  if (!id) return { ok: true };
  const record = readRecord(dataDir, id);
  if (record && !same(record.ipHash, hashIp(ip))) return { ok: false, error: 'ip_locked' };
  const path = pathFor(dataDir, id);
  if (path) rmSync(path, { force: true });
  return { ok: true };
}
