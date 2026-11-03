import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { MUSE_KEY_HEADER, PASSCODE_HEADER } from '@shared/api';
import { loadEnv } from './env';
import { activeMuseKey, rememberUserKey, resolveAccess, runWithAccess, runWithFilmKey } from './credentials';

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

const env = (over: Record<string, string | undefined>) => loadEnv({ ...over });

it('a Director code spends the server key, even when a visitor key is also sent', () => {
  const headers = new Headers({ [PASSCODE_HEADER]: 'studio-code', [MUSE_KEY_HEADER]: 'visitor-key-123' });
  const resolved = resolveAccess(headers, env({ DIRECTOR_PASSCODE: 'studio-code', META_API_KEY: 'server-key-123' }));
  expect(resolved).toEqual({ ok: true, access: { source: 'code', key: 'server-key-123' } });
});

it('a visitor key is used when the code is missing or wrong', () => {
  const headers = new Headers({ [MUSE_KEY_HEADER]: 'visitor-key-123' });
  const resolved = resolveAccess(headers, env({ DIRECTOR_PASSCODE: 'studio-code', META_API_KEY: 'server-key-123' }));
  expect(resolved).toEqual({ ok: true, access: { source: 'user', key: 'visitor-key-123' } });
  const wrong = resolveAccess(new Headers({ [PASSCODE_HEADER]: 'nope', [MUSE_KEY_HEADER]: 'visitor-key-123' }), env({ DIRECTOR_PASSCODE: 'studio-code', META_API_KEY: 'server-key-123' }));
  expect(wrong).toEqual({ ok: true, access: { source: 'user', key: 'visitor-key-123' } });
});

it('refuses a deployed request that has neither a code nor a key', () => {
  expect(resolveAccess(new Headers(), env({ DIRECTOR_PASSCODE: 'studio-code', META_API_KEY: 'server-key-123' })).ok).toBe(false);
  expect(resolveAccess(new Headers({ [MUSE_KEY_HEADER]: 'short' }), env({ DIRECTOR_PASSCODE: 'studio-code' })).ok).toBe(false);
});

it('uses the server key when no code is configured', () => {
  const resolved = resolveAccess(new Headers(), env({ META_API_KEY: 'server-key-123' }));
  expect(resolved).toEqual({ ok: true, access: { source: 'server', key: 'server-key-123' } });
});

it('keeps a visitor key for a film that starts after the request', () => {
  const dir = mkdtempSync(join(tmpdir(), 'director-keys-'));
  process.env.META_API_KEY = 'server-key-123';
  runWithAccess({ source: 'user', key: 'visitor-key-123' }, () => {
    rememberUserKey(dir, 'film_abc');
    expect(activeMuseKey()).toBe('visitor-key-123');
  });
  expect(activeMuseKey('server-key-123')).toBe('server-key-123');
  runWithFilmKey(dir, 'film_abc', () => {
    expect(activeMuseKey()).toBe('visitor-key-123');
  });
  runWithAccess({ source: 'code', key: 'server-key-123' }, () => {
    runWithFilmKey(dir, 'film_abc', () => {
      expect(activeMuseKey()).toBe('server-key-123');
    });
  });
});
