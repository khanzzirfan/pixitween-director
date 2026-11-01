import { describe, expect, it } from 'vitest';
import { hashString, seedFor } from './seed';

describe('seedFor', () => {
  it('is deterministic for the same frame and salt', () => {
    expect(seedFor(10, 3)).toBe(seedFor(10, 3));
  });

  it('returns a value in [0, 1)', () => {
    const v = seedFor(10, 3);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(1);
  });

  it('differs for a different frame', () => {
    expect(seedFor(10, 3)).not.toBe(seedFor(11, 3));
  });

  it('differs for a different salt', () => {
    expect(seedFor(10, 3)).not.toBe(seedFor(10, 4));
  });

  it('spreads values across consecutive frames', () => {
    const values = new Set<number>();
    for (let frame = 0; frame < 100; frame++) values.add(seedFor(frame, 7));
    expect(values.size).toBeGreaterThan(90);
  });
});

describe('hashString', () => {
  it('is deterministic and a 32-bit unsigned integer', () => {
    const h = hashString('glitch');
    expect(h).toBe(hashString('glitch'));
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(2 ** 32);
  });

  it('differs for different strings', () => {
    expect(hashString('crt')).not.toBe(hashString('oldFilm'));
  });
});
