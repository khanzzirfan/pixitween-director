import { expect, it } from 'vitest';
import { buildKeys, cubicBezierEase, isAnimated, sampleScalar, sampleVec2 } from './keyframes';

const linear = [{ t: 0, v: 0 }, { t: 60, v: 1 }];

it('samples linearly and clamps outside the keys', () => {
  expect(sampleScalar(linear, 0, 30)).toBe(0.5);
  expect(sampleScalar(linear, 0, 90)).toBe(1);
  expect(sampleScalar(linear, 0, -5)).toBe(0);
  expect(sampleScalar(7, 0, 30)).toBe(7);
  expect(sampleScalar(undefined, 3, 30)).toBe(3);
});
it('applies the easeOut bezier of the segment start', () => {
  const v = sampleScalar([{ t: 0, v: 0, easeOut: [0, 0, 0.58, 1] }, { t: 60, v: 1 }], 0, 30);
  expect(v).toBeGreaterThan(0.5);
  expect(v).toBeLessThanOrEqual(0.9);
  expect(cubicBezierEase([0, 0, 0.58, 1], 0)).toBe(0);
  expect(cubicBezierEase([0, 0, 0.58, 1], 1)).toBe(1);
});
it('samples vec2 and detects animation', () => {
  const f = [{ t: 0, v: [0, 100] as [number, number] }, { t: 10, v: [10, 200] as [number, number] }];
  expect(sampleVec2(f, [0, 0], 5)).toEqual([5, 150]);
  expect(isAnimated(f)).toBe(true);
  expect(isAnimated([1, 2])).toBe(false);
});
it('builds keys', () => {
  expect(buildKeys([[0, 0.9], [2, 1]], 'easeOut', 30, 120)).toEqual([{ t: 0, v: 0.9, easeOut: [0, 0, 0.58, 1] }, { t: 60, v: 1 }]);
  expect(buildKeys([[0, 0], [1, 1]], 'linear', 30, 120).every((k) => k.easeOut === undefined)).toBe(true);
});
it('validates keys', () => {
  expect(() => buildKeys([[0, 0], [5, 1]], 'linear', 30, 120)).toThrow(/time_out_of_range.*4/);
  expect(() => buildKeys([[1, 0], [1.01, 1]], 'linear', 30, 120)).toThrow(/keys_too_close/);
  expect(() => buildKeys([[0, 2]], 'linear', 30, 120, { min: 0, max: 1 })).toThrow(/bad_value/);
  expect(() => buildKeys([[2, 0], [1, 1]], 'linear', 30, 120)).toThrow(/ascending/);
});
