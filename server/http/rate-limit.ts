// Owned by S8b. A small in-memory sliding-window limiter: a visitor cannot burn the demo's budget.
export interface RateCheck {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
}

export function createRateLimiter(opts: { windowMs: number; max: number; now?: () => number }) {
  const now = opts.now ?? Date.now;
  const hits = new Map<string, number[]>();

  const live = (key: string): number[] => {
    const cutoff = now() - opts.windowMs;
    const kept = (hits.get(key) ?? []).filter((t) => t > cutoff);
    if (kept.length) hits.set(key, kept);
    else hits.delete(key);
    return kept;
  };

  /** What a check would answer right now, without recording anything. */
  const answer = (kept: number[]): RateCheck =>
    kept.length < opts.max
      ? { allowed: true, remaining: opts.max - kept.length - 1, retryAfterSec: 0 }
      : { allowed: false, remaining: 0, retryAfterSec: Math.ceil((kept[0]! + opts.windowMs - now()) / 1000) };

  return {
    check(key: string): RateCheck {
      const kept = live(key);
      const r = answer(kept);
      if (r.allowed) hits.set(key, [...kept, now()]);
      return r;
    },
    peek: (key: string): RateCheck => answer(live(key)),
    size: () => hits.size,
    sweep(): void {
      for (const key of [...hits.keys()]) live(key);
    },
  };
}

export type RateLimiter = ReturnType<typeof createRateLimiter>;
