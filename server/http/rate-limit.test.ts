import { expect, it } from 'vitest';
import { createRateLimiter } from './rate-limit';

const HOUR = 3_600_000;
const make = (max: number) => {
  let t = 0;
  const l = createRateLimiter({ windowMs: HOUR, max, now: () => t });
  return { l, at: (ms: number) => void (t = ms) };
};

it('allows max and counts what is left', () => {
  const { l, at } = make(3);
  const seen: number[] = [];
  for (const ms of [0, 1000, 2000]) {
    at(ms);
    const r = l.check('a');
    expect(r.allowed).toBe(true);
    seen.push(r.remaining);
  }
  expect(seen).toEqual([2, 1, 0]);
});

it('denies the next one without extending the window, then lets the key back in', () => {
  const { l, at } = make(3);
  for (const ms of [0, 1000, 2000]) {
    at(ms);
    l.check('a');
  }
  at(3000);
  expect(l.check('a')).toEqual({ allowed: false, remaining: 0, retryAfterSec: 3597 });
  at(3500);
  expect(l.check('a').retryAfterSec).toBe(3597); // 3596.5 s rounded up: still counted from the first hit, not from the denied calls
  at(HOUR + 1);
  expect(l.check('a').allowed).toBe(true);
});

it('keeps keys apart', () => {
  const { l } = make(1);
  expect(l.check('a').allowed).toBe(true);
  expect(l.check('b').allowed).toBe(true);
  expect(l.check('a').allowed).toBe(false);
});

it('sweeps expired keys', () => {
  const { l, at } = make(1);
  l.check('a');
  l.check('b');
  expect(l.size()).toBe(2);
  at(HOUR * 2);
  l.sweep();
  expect(l.size()).toBe(0);
});

it('peek never spends budget', () => {
  const { l, at } = make(1);
  expect(l.peek('a').allowed).toBe(true);
  expect(l.check('a')).toMatchObject({ allowed: true, remaining: 0 });
  at(1);
  expect(l.peek('a').allowed).toBe(false);
});
