// Owned by S8b. The visitor's address for rate limits. X-Forwarded-For is spoofable and is never read.
import { createHash } from 'node:crypto';
import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context } from 'hono';
import { getLimits } from './limits-config';

const warned = new Set<string>();
const warnOnce = (id: string, line: string) => {
  if (warned.has(id)) return;
  warned.add(id);
  console.warn(line);
};

/** Fly-Client-IP is only trustworthy when nothing else sits in front of Fly, so it is used only when TRUST_FLY_CLIENT_IP says so. */
export function clientIp(c: Context, opts: { trustFlyHeader?: boolean } = {}): string {
  const trust = opts.trustFlyHeader ?? getLimits().trustFlyClientIp;
  const fly = trust ? c.req.header('fly-client-ip')?.trim() : undefined;
  if (fly) return fly;
  if (process.env.FLY_APP_NAME && !trust)
    warnOnce('fly', '[client-ip] running on Fly without TRUST_FLY_CLIENT_IP=true: every visitor shares the proxy address, so the per-visitor limits act as one global limit');
  try {
    const address = getConnInfo(c).remote.address;
    if (address) return address;
  } catch {
    // not running under @hono/node-server (app.request in tests)
  }
  if (process.env.NODE_ENV === 'production') warnOnce('unknown', '[client-ip] no visitor address available: all requests share one rate-limit key');
  return 'unknown';
}

/** Eight hex characters, so a log line identifies a visitor without storing the address. */
export const hashIp = (ip: string): string => createHash('sha256').update(ip).digest('hex').slice(0, 8);
