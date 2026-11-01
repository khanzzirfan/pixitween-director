import { afterEach, describe, expect, it } from 'vitest';
import { MotionClock } from '../core/clock';
import { compileTweens, primeTimeline, type Resolve, type Tween } from './compile';
import { cubicBezier, parseCubicArgs, resolveEase } from './eases';

describe('cubicBezier', () => {
  it('is the identity curve for cubic(0,0,1,1)', () => {
    expect(cubicBezier(0, 0, 1, 1)(0.3)).toBeCloseTo(0.3, 6);
  });

  it('is symmetric around the midpoint for a symmetric curve', () => {
    expect(cubicBezier(0.42, 0, 0.58, 1)(0.5)).toBeCloseTo(0.5, 6);
  });

  it('eases in below the linear value early in an ease-in curve', () => {
    expect(cubicBezier(0.42, 0, 1, 1)(0.25)).toBeLessThan(0.25);
  });

  it('clamps the endpoints', () => {
    const ease = cubicBezier(0.25, 0.1, 0.25, 1);
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
  });
});

describe('parseCubicArgs / resolveEase', () => {
  it('parses a bare cubic(...) call into its 4 numbers', () => {
    expect(parseCubicArgs('cubic(0.42, 0, 0.58, 1)')).toEqual([0.42, 0, 0.58, 1]);
  });

  it('returns null for anything else', () => {
    expect(parseCubicArgs('power2.inOut')).toBeNull();
    expect(parseCubicArgs('cubic.out(0.42,0,0.58,1)')).toBeNull();
  });

  it('passes non-cubic ease strings through unchanged', () => {
    expect(resolveEase('power2.inOut')).toBe('power2.inOut');
    expect(resolveEase(undefined)).toBeUndefined();
  });

  it('turns cubic(...) into an ease function', () => {
    const ease = resolveEase('cubic(0.42,0,0.58,1)');
    expect(typeof ease).toBe('function');
    expect((ease as (t: number) => number)(0.5)).toBeCloseTo(0.5, 6);
  });
});

describe('cubic(...) ease compiled on a clock', () => {
  const clocks: MotionClock[] = [];

  afterEach(() => {
    for (const clock of clocks.splice(0)) clock.destroy();
  });

  function makeClock(duration = 1): MotionClock {
    const clock = new MotionClock({ duration, fps: 30 });
    clocks.push(clock);
    return clock;
  }

  function resolver(node: object): Resolve {
    return (_target, prop) => {
      if (!Object.prototype.hasOwnProperty.call(node, prop)) return null;
      return { obj: node, key: prop, kind: 'number' };
    };
  }

  it('reads the symmetric curve value at the midpoint, deterministically across seeks', () => {
    const clock = makeClock();
    const node = { x: 0 };
    const tweens: Tween[] = [{ at: 0, duration: 1, ease: 'cubic(0.42,0,0.58,1)', to: { x: 100 } }];

    compileTweens(clock.timeline, tweens, { layerStart: 0, resolve: resolver(node), layerId: 'a' });
    primeTimeline(clock.timeline);

    clock.seek(0.5);
    expect(node.x).toBeCloseTo(50, 5);

    clock.seek(0.9);
    clock.seek(0);
    clock.seek(0.5);
    expect(node.x).toBeCloseTo(50, 5);
  });
});
