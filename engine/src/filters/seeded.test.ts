import { describe, expect, it } from 'vitest';
import { mulberry32, withSeededRandom } from './seeded';

describe('mulberry32', () => {
  it('is deterministic for the same seed', () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it('returns values in [0, 1)', () => {
    const random = mulberry32(7);
    for (let i = 0; i < 100; i++) {
      const v = random();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('differs for a different seed', () => {
    expect(mulberry32(7)()).not.toBe(mulberry32(8)());
  });
});

describe('withSeededRandom', () => {
  it('returns identical arrays for the same seed', () => {
    const a = withSeededRandom(0.25, () => [Math.random(), Math.random()]);
    const b = withSeededRandom(0.25, () => [Math.random(), Math.random()]);
    expect(a).toEqual(b);
  });

  it('differs for a different seed', () => {
    const a = withSeededRandom(0.25, () => [Math.random(), Math.random()]);
    const b = withSeededRandom(0.5, () => [Math.random(), Math.random()]);
    expect(a).not.toEqual(b);
  });

  it('swaps Math.random during the call and restores it after', () => {
    const original = Math.random;
    let inside: typeof Math.random | undefined;
    const result = withSeededRandom(0.5, () => {
      inside = Math.random;
      return Math.random();
    });
    expect(inside).not.toBe(original);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(Math.random).toBe(original);
  });

  it('restores the original Math.random when fn throws', () => {
    const original = Math.random;
    expect(() =>
      withSeededRandom(0.25, () => {
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(Math.random).toBe(original);
  });

  it('passes through the return value of fn', () => {
    expect(withSeededRandom(0.1, () => 'ok')).toBe('ok');
  });
});
