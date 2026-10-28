import { describe, expect, it } from 'vitest';
import { sampleScalar, sampleVec2 } from './sample';

describe('review keyframe sampling', () => {
  it('samples static, interpolated and out-of-range scalar values', () => {
    const keys = [
      { t: 0, v: 0 },
      { t: 30, v: 1 },
    ];
    expect(sampleScalar(keys, 0, 15)).toBe(0.5);
    expect(sampleScalar(keys, 0, -5)).toBe(0);
    expect(sampleScalar(keys, 0, 99)).toBe(1);
    expect(sampleScalar(7, 0, 15)).toBe(7);
  });
  it('honours hold and engine cubic easing', () => {
    expect(
      sampleScalar(
        [
          { t: 0, v: 0, hold: true },
          { t: 30, v: 1 },
        ],
        0,
        15,
      ),
    ).toBe(0);
    expect(
      sampleScalar(
        [
          { t: 0, v: 0, easeOut: [0.4, 0, 0.2, 1] },
          { t: 30, v: 1 },
        ],
        0,
        15,
      ),
    ).toBeCloseTo(0.7755613, 6);
  });
  it('returns a static vec2 as-is instead of reading it as keyframes', () => {
    expect(sampleVec2([960, 540] as unknown as [number, number], [0, 0], 10)).toEqual([960, 540]);
  });
  it('interpolates vectors by component', () => {
    expect(
      sampleVec2(
        [
          { t: 0, v: [0, 0] },
          { t: 30, v: [100, 200] },
        ],
        [0, 0],
        15,
      ),
    ).toEqual([50, 100]);
  });
});
