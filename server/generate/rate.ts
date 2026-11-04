// Owned by S7b. Server-wide sliding-window cap on clip submissions.
import { loadEnv } from '../env';

export type RateResult = { ok: true } | { ok: false; retryAfterSec: number };

export interface RateLimiterOptions {
  now?: () => number;
  max?: number;
  windowMs?: number;
}

export interface RateLimiter {
  peek(): RateResult;
  tryAcquire(): RateResult;
}

export function createRateLimiter(o: RateLimiterOptions = {}): RateLimiter {
  const now = o.now ?? Date.now;
  const windowMs = o.windowMs ?? 3600000;
  const stamps: number[] = [];

  const check = (record: boolean): RateResult => {
    const t = now();
    while (stamps.length > 0 && stamps[0]! + windowMs <= t) stamps.shift();
    const max = o.max ?? loadEnv().GENERATE_MAX_PER_HOUR;
    if (stamps.length >= max) return { ok: false, retryAfterSec: Math.ceil((stamps[0]! + windowMs - t) / 1000) };
    if (record) stamps.push(t);
    return { ok: true };
  };

  return { peek: () => check(false), tryAcquire: () => check(true) };
}

let shared: RateLimiter | undefined;
export function getRateLimiter(): RateLimiter {
  return (shared ??= createRateLimiter());
}
