import { describe, expect, it, vi } from 'vitest';

vi.mock('../env', () => ({ loadEnv: () => ({ GENERATE_MAX_PER_HOUR: 2 }) }));
import { createRateLimiter } from './rate';

describe('createRateLimiter', () => {
  it('allows max then blocks until the window passes', () => {
    let t = 0;
    const r = createRateLimiter({ now: () => t, max: 4 });
    for (let i = 0; i < 4; i++) expect(r.tryAcquire()).toEqual({ ok: true });
    expect(r.tryAcquire()).toEqual({ ok: false, retryAfterSec: 3600 });
    t = 3601_000;
    expect(r.tryAcquire()).toEqual({ ok: true });
  });

  it('peek never consumes a slot', () => {
    const r = createRateLimiter({ now: () => 0, max: 4 });
    for (let i = 0; i < 10; i++) r.peek();
    for (let i = 0; i < 4; i++) expect(r.tryAcquire().ok).toBe(true);
    expect(r.tryAcquire().ok).toBe(false);
  });

  it('defaults max to the validated env value', () => {
    const r = createRateLimiter({ now: () => 0 });
    r.tryAcquire();
    r.tryAcquire();
    expect(r.tryAcquire().ok).toBe(false);
  });

  it('computes retryAfterSec from the oldest entry', () => {
    let t = 0;
    const r = createRateLimiter({ now: () => t, max: 1 });
    r.tryAcquire();
    t = 1000_000;
    expect(r.tryAcquire()).toEqual({ ok: false, retryAfterSec: 2600 });
  });
});
