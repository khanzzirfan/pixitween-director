// Owned by S8b. At most N new films per visitor per hour.
import type { MiddlewareHandler } from 'hono';
import { clientIp, hashIp } from './client-ip';
import { getLimits } from './limits-config';
import { createRateLimiter, type RateLimiter } from './rate-limit';

const HOUR = 3_600_000;

export function createFilmLimit(deps: { limiter?: RateLimiter; max?: number; log?: (line: string) => void } = {}): MiddlewareHandler {
  let limiter = deps.limiter;
  const log = deps.log ?? ((line: string) => console.log(line));
  return async (c, next) => {
    if (c.req.method !== 'POST' || c.req.path !== '/api/films') return next();
    const max = deps.max ?? getLimits().filmsPerHourPerIp; // read when first needed, so a test can set the env before the first request
    limiter ??= createRateLimiter({ windowMs: HOUR, max });
    const key = clientIp(c);
    const r = limiter.check(key);
    if (r.allowed) return next();
    log(`[rate-limit] key=${hashIp(key)} path=/api/films window=${max}/${max}`);
    c.header('Retry-After', String(r.retryAfterSec));
    return c.json({ error: 'rate_limited', retryAfterSec: r.retryAfterSec }, 429);
  };
}
