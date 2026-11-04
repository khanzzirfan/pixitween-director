// Owned by S8b. A coarse cap on generate approvals, in front of S7b's own authoritative one.
// It is one budget for the whole demo on purpose: a clip costs the same whoever approves it.
import type { MiddlewareHandler } from 'hono';
import { getLimits } from './limits-config';
import { createRateLimiter, startSweeper, type RateLimiter } from './rate-limit';

const HOUR = 3_600_000;
const APPROVE = /^\/api\/films\/[^/]+\/scenes\/[^/]+\/approve$/;

export function createGenerateCap(deps: { limiter?: RateLimiter; max?: number } = {}): MiddlewareHandler {
  let limiter = deps.limiter;
  return async (c, next) => {
    if (c.req.method !== 'POST' || !APPROVE.test(c.req.path)) return next();
    if (!limiter) {
      limiter = createRateLimiter({ windowMs: HOUR, max: deps.max ?? getLimits().generateMaxPerHour });
      startSweeper(limiter);
    }
    const r = limiter.check('global');
    if (!r.allowed) {
      c.header('Retry-After', String(r.retryAfterSec));
      return c.json({ error: 'generate_cap', retryAfterSec: r.retryAfterSec }, 429);
    }
    // an approval that was refused (bad id, wrong state, busy) started no clip, so it does not use the budget
    try {
      await next();
    } catch (e) {
      limiter.refund('global');
      throw e;
    }
    if (c.res.status >= 400) limiter.refund('global');
  };
}
