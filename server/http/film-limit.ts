// Owned by S8b. At most N new films per visitor per hour.
import type { MiddlewareHandler } from 'hono';
import { clientIp, hashIp } from './client-ip';
import { getLimits } from './limits-config';
import { createRateLimiter, startSweeper, type RateLimiter } from './rate-limit';

const HOUR = 3_600_000;

export function createFilmLimit(deps: { limiter?: RateLimiter; max?: number; log?: (line: string) => void } = {}): MiddlewareHandler {
  let limiter = deps.limiter;
  const log = deps.log ?? ((line: string) => console.log(line));
  return async (c, next) => {
    if (c.req.method !== 'POST' || c.req.path !== '/api/films') return next();
    const max = deps.max ?? getLimits().filmsPerHourPerIp; // read when first needed, so a test can set the env before the first request
    if (!limiter) {
      limiter = createRateLimiter({ windowMs: HOUR, max });
      startSweeper(limiter);
    }
    const key = clientIp(c);
    const r = limiter.check(key); // reserved before the handler runs, so simultaneous requests cannot all slip under the limit
    if (!r.allowed) {
      log(`[rate-limit] key=${hashIp(key)} path=/api/films limit=${max}/hour retryAfterSec=${r.retryAfterSec}`);
      c.header('Retry-After', String(r.retryAfterSec));
      return c.json({ error: 'rate_limited', retryAfterSec: r.retryAfterSec }, 429);
    }
    // only a film that started counts: a bad upload, a full queue or a server error gives the slot back
    try {
      await next();
    } catch (e) {
      limiter.refund(key);
      throw e;
    }
    if (c.res.status >= 400) limiter.refund(key);
  };
}
