import { describe, expect, it } from 'vitest';
import { easeFor, isKeyframed, propertyTweens } from './keyframes';

describe('isKeyframed', () => {
  it('is false for a constant number', () => {
    expect(isKeyframed(0.5)).toBe(false);
  });

  it('is false for a constant vector (looks like an array but not of keyframes)', () => {
    expect(isKeyframed([960, 561.6])).toBe(false);
  });

  it('is true for an array of keyframes', () => {
    expect(isKeyframed([{ t: 0, v: 0 }, { t: 18, v: 1 }])).toBe(true);
  });
});

describe('easeFor', () => {
  it('is none with no handles on either keyframe', () => {
    expect(easeFor({ t: 0, v: 0 }, { t: 18, v: 1 })).toBe('none');
  });

  it('builds cubic from k0.easeOut, falling back to its end handle for x2/y2', () => {
    expect(easeFor({ t: 0, v: 0, easeOut: [0, 0, 0.58, 1] }, { t: 18, v: 1 })).toBe('cubic(0,0,0.58,1)');
  });

  it('prefers k1.easeIn end handle over k0.easeOut end handle', () => {
    expect(easeFor({ t: 0, v: 0, easeOut: [0, 0, 0.58, 1] }, { t: 18, v: 1, easeIn: [0.2, 0.3, 0.9, 0.8] })).toBe('cubic(0,0,0.9,0.8)');
  });
});

describe('propertyTweens', () => {
  it('converts a single opacity keyframe pair to initial + one tween', () => {
    const result = propertyTweens(
      [
        { t: 0, v: 0, easeOut: [0, 0, 0.58, 1] },
        { t: 18, v: 1 },
      ],
      { fps: 30, inPoint: 0, props: ['alpha'] },
    );
    expect(result).toEqual({
      initial: { alpha: 0 },
      tweens: [{ at: 0, duration: 0.6, from: { alpha: 0 }, to: { alpha: 1 }, ease: 'cubic(0,0,0.58,1)' }],
    });
  });

  it('converts a position vector keyframe pair into one tween with x/y in the same fromTo', () => {
    const result = propertyTweens(
      [
        { t: 0, v: [960, 561.6] },
        { t: 120, v: [960, 563.76] },
      ],
      { fps: 30, inPoint: 0, props: ['x', 'y'] },
    );
    expect(result.tweens).toHaveLength(1);
    expect(result.tweens[0]).toEqual({
      at: 0,
      duration: 4,
      from: { x: 960, y: 561.6 },
      to: { x: 960, y: 563.76 },
      ease: 'none',
    });
  });

  it('gives initial + no tweens for a constant value', () => {
    const result = propertyTweens(0.5, { fps: 30, inPoint: 0, props: ['alpha'] });
    expect(result).toEqual({ initial: { alpha: 0.5 }, tweens: [] });
  });

  it('gives two tweens back to back for three keyframes', () => {
    const result = propertyTweens(
      [
        { t: 0, v: 0 },
        { t: 15, v: 0.5 },
        { t: 30, v: 1 },
      ],
      { fps: 30, inPoint: 0, props: ['alpha'] },
    );
    expect(result.tweens).toHaveLength(2);
    expect(result.tweens[0]).toEqual({ at: 0, duration: 0.5, from: { alpha: 0 }, to: { alpha: 0.5 }, ease: 'none' });
    expect(result.tweens[1]).toEqual({ at: 0.5, duration: 0.5, from: { alpha: 0.5 }, to: { alpha: 1 }, ease: 'none' });
  });

  it('starts the tween relative to inPoint', () => {
    const result = propertyTweens(
      [
        { t: 45, v: 0 },
        { t: 60, v: 1 },
      ],
      { fps: 30, inPoint: 30, props: ['alpha'] },
    );
    expect(result.tweens[0].at).toBe(0.5);
  });

  it('skips a zero-length keyframe pair', () => {
    const result = propertyTweens(
      [
        { t: 0, v: 0 },
        { t: 0, v: 0.2 },
        { t: 30, v: 1 },
      ],
      { fps: 30, inPoint: 0, props: ['alpha'] },
    );
    expect(result.tweens).toHaveLength(1);
    expect(result.tweens[0]).toEqual({ at: 0, duration: 1, from: { alpha: 0.2 }, to: { alpha: 1 }, ease: 'none' });
  });

  it('clamps at to >= 0 when a keyframe starts before inPoint', () => {
    const result = propertyTweens(
      [
        { t: 0, v: 0 },
        { t: 30, v: 1 },
      ],
      { fps: 30, inPoint: 30, props: ['alpha'] },
    );
    expect(result.tweens[0].at).toBe(0);
  });
});
