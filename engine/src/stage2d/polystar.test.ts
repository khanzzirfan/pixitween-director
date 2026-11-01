import { describe, expect, it } from 'vitest';
import { insetPolystar, polystarCorners } from './polystar';

/** The distance from the centre to a corner. */
function radiusOf(corner: { x: number; y: number }): number {
  return Math.hypot(corner.x, corner.y);
}

describe('polystarCorners', () => {
  it('gives a 16-point star 32 corners that alternate the outer and the inner radius', () => {
    const corners = polystarCorners({ points: 16, outerRadius: 100, innerRadius: 43, starType: 'star' });

    expect(corners).toHaveLength(32);
    corners.forEach((corner, index) => {
      const expected = index % 2 === 0 ? 100 : 43;
      expect(Math.abs(radiusOf(corner) - expected)).toBeLessThan(1e-6);
    });
  });

  it('gives a 6-point polygon 6 corners, all on the outer radius', () => {
    const corners = polystarCorners({ points: 6, outerRadius: 100, innerRadius: 43, starType: 'polygon' });

    expect(corners).toHaveLength(6);
    corners.forEach((corner) => {
      expect(Math.abs(radiusOf(corner) - 100)).toBeLessThan(1e-6);
    });
  });

  it('gives a 5-point star 10 corners', () => {
    expect(polystarCorners({ points: 5, outerRadius: 100, innerRadius: 43, starType: 'star' })).toHaveLength(10);
  });

  it('starts straight up and goes clockwise', () => {
    const corners = polystarCorners({ points: 4, outerRadius: 100, innerRadius: 50, starType: 'star' });

    // The doc's shape space has y downwards, so straight up is a negative y.
    expect(corners[0].x).toBeCloseTo(0, 6);
    expect(corners[0].y).toBeCloseTo(-100, 6);
    // The next corner is to the right of the first one.
    expect(corners[1].x).toBeGreaterThan(0);
  });

  it('keeps the inner radius inside the outer one', () => {
    const corners = polystarCorners({ points: 4, outerRadius: 100, innerRadius: 500, starType: 'star' });
    corners.forEach((corner, index) => {
      const expected = index % 2 === 0 ? 100 : 100;
      expect(Math.abs(radiusOf(corner) - expected)).toBeLessThan(1e-6);
    });
  });
});

describe('insetPolystar', () => {
  it('pulls the star in by the stroke width', () => {
    const inset = insetPolystar({ points: 16, outerRadius: 100, innerRadius: 43, starType: 'star' }, 10);

    expect(inset.outerRadius).toBe(90);
    expect(inset.innerRadius).toBe(33);
  });

  it('keeps the inner corners apart when the stroke is wider than the inner radius', () => {
    const inset = insetPolystar({ points: 16, outerRadius: 100, innerRadius: 5, starType: 'star' }, 20);

    expect(inset.outerRadius).toBe(80);
    expect(inset.innerRadius).toBeGreaterThan(0);
  });
});
