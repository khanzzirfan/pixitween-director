// Owned by S8b. The visitor's address for rate limits. X-Forwarded-For is spoofable and is never read.
import { createHash } from 'node:crypto';
import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context } from 'hono';
import { getLimits } from './limits-config';

/** Fly-Client-IP is only trustworthy when nothing else sits in front of Fly, so it is used only when TRUST_FLY_CLIENT_IP says so. */
export function clientIp(c: Context, opts: { trustFlyHeader?: boolean } = {}): string {
  const trust = opts.trustFlyHeader ?? getLimits().trustFlyClientIp;
  const fly = trust ? c.req.header('fly-client-ip')?.trim() : undefined;
  if (fly) return fly;
  try {
    return getConnInfo(c).remote.address ?? 'unknown';
  } catch {
    return 'unknown'; // not running under @hono/node-server (app.request in tests)
  }
}

/** Eight hex characters, so a log line identifies a visitor without storing the address. */
export const hashIp = (ip: string): string => createHash('sha256').update(ip).digest('hex').slice(0, 8);
