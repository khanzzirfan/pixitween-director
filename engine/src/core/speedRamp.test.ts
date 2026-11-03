import { describe, expect, it } from 'vitest';
import { rampCurve, rampProgress, rampTime, warpClock } from './speedRamp';

const SLOW = [{ at: 0, rate: 1 }, { at: 0.3, rate: 0.2 }, { at: 0.7, rate: 0.2 }, { at: 1, rate: 1 }];

describe('speed ramps', () => {
  it('a flat curve is the clock itself', () => {
    for (const u of [0, 0.25, 0.5, 1]) expect(rampProgress([{ at: 0, rate: 1 }, { at: 1, rate: 1 }], u)).toBeCloseTo(u, 9);
  });

  it('starts at 0, ends at 1, and never goes backwards', () => {
    expect(rampProgress(SLOW, 0)).toBe(0);
    expect(rampProgress(SLOW, 1)).toBe(1);
    let last = 0;
    for (let n = 1; n <= 100; n++) {
      const w = rampProgress(SLOW, n / 100);
      expect(w).toBeGreaterThanOrEqual(last);
      last = w;
    }
  });

  it('covers little ground in the slow middle', () => {
    // 40 % of the time (0.3 to 0.7) at a fifth speed moves far less than 40 % of the shot
    const gain = rampProgress(SLOW, 0.7) - rampProgress(SLOW, 0.3);
    expect(gain).toBeLessThan(0.2);
    expect(rampProgress(SLOW, 0.5)).toBeCloseTo(0.5, 2);
  });

  it('rampTime inverts rampProgress', () => {
    for (const u of [0.05, 0.3, 0.5, 0.64, 0.95]) expect(rampTime(SLOW, rampProgress(SLOW, u))).toBeCloseTo(u, 6);
  });

  it('adds the ends and holds rates in range', () => {
    const c = rampCurve([{ at: 0.5, rate: 99 }, { at: 0.2, rate: 0 }]);
    expect(c[0]).toEqual({ at: 0, rate: 0.05 });
    expect(c.at(-1)).toEqual({ at: 1, rate: 4 });
    expect(rampCurve([])).toEqual([{ at: 0, rate: 1 }, { at: 1, rate: 1 }]);
  });

  it('warps the world clock inside a span and meets the real clock at both ends', () => {
    const spans = [{ from: 2, to: 3, rates: SLOW }];
    expect(warpClock(undefined, 2.5)).toBe(2.5);
    expect(warpClock(spans, 1.9)).toBe(1.9);
    expect(warpClock(spans, 3.2)).toBe(3.2);
    expect(warpClock(spans, 2)).toBe(2);
    expect(warpClock(spans, 3)).toBe(3);
    expect(warpClock(spans, 2.5)).toBeCloseTo(2.5, 2);
    expect(warpClock(spans, 2.4)).toBeGreaterThan(2.4);
    expect(warpClock(spans, 2.4)).toBe(warpClock(spans, 2.4));
  });
});
