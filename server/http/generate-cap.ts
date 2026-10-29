// Owned by S8b. A coarse cap on generate approvals, in front of S7b's own authoritative one.
import type { MiddlewareHandler } from 'hono';
import { getLimits } from './limits-config';
import { createRateLimiter, type RateLimiter } from './rate-limit';

const HOUR = 3_600_000;
const APPROVE = /^\/api\/films\/[^/]+\/scenes\/[^/]+\/approve$/;

export function createGenerateCap(deps: { limiter?: RateLimiter; max?: number } = {}): MiddlewareHandler {
  let limiter = deps.limiter;
  return async (c, next) => {
    if (c.req.method !== 'POST' || !APPROVE.test(c.req.path)) return next();
    limiter ??= createRateLimiter({ windowMs: HOUR, max: deps.max ?? getLimits().generateMaxPerHour });
    const r = limiter.check('global');
    if (r.allowed) return next();
    c.header('Retry-After', String(r.retryAfterSec));
    return c.json({ error: 'generate_cap', retryAfterSec: r.retryAfterSec }, 429);
  };
}
