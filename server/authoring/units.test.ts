import { expect, it } from 'vitest';
import { framesToSec, secToFrames } from './units';

it('converts seconds to frames', () => {
  expect(secToFrames(2)).toBe(60);
  expect(secToFrames(0.5)).toBe(15);
  expect(secToFrames(0.016)).toBe(0);
  expect(secToFrames(1, 24)).toBe(24);
  expect(() => secToFrames(-1)).toThrow(RangeError);
  expect(() => secToFrames(-1)).toThrow(/-1/);
  expect(() => secToFrames(Number.NaN)).toThrow(RangeError);
  expect(framesToSec(45)).toBe(1.5);
});
