import { timingSafeEqual } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import { PASSCODE_HEADER } from '@shared/api';
import { resolveAccess, runWithAccess } from '../credentials';
import { loadEnv } from '../env';

const same = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** True when no passcode is configured, or the `x-director-passcode` header or `Authorization: Bearer` value matches it. */
export function isAuthorised(headers: Headers, passcode: string | undefined): boolean {
  if (!passcode) return true;
  const direct = headers.get(PASSCODE_HEADER);
  if (direct !== null && same(direct, passcode)) return true;
  const auth = headers.get('authorization');
  const bearer = auth?.match(/^Bearer\s+(.+)$/i)?.[1];
  return bearer !== undefined && same(bearer.trim(), passcode);
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Video keys are the visitor's own. They are not the Muse passcode, and they are locked to the session and IP. */
function isVisitorVideoRoute(path: string): boolean {
  return path === '/api/video-keys' || path === '/api/videos' || path.startsWith('/api/videos/');
}

export const passcode: MiddlewareHandler = async (c, next) => {
  if (!MUTATING.has(c.req.method) || isVisitorVideoRoute(c.req.path)) {
    await next();
    return;
  }
  const resolved = resolveAccess(c.req.raw.headers, loadEnv());
  if (!resolved.ok) return c.json({ error: 'passcode_required' }, 401);
  await runWithAccess(resolved.access, () => next());
};
