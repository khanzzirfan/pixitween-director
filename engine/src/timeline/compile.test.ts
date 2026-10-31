import { afterEach, describe, expect, it } from 'vitest';
import { MotionClock } from '../core/clock';
import type { TargetRef } from '../core/paths';
import { compileTweens, primeTimeline, type Resolve, type Tween } from './compile';

const clocks: MotionClock[] = [];

function makeClock(duration = 6): MotionClock {
  const clock = new MotionClock({ duration, fps: 30 });
  clocks.push(clock);
  return clock;
}

afterEach(() => {
  for (const clock of clocks.splice(0)) clock.destroy();
});

/** A resolver over a plain object: any own key resolves, with the given kind. */
function resolver(node: object, kinds: Record<string, TargetRef['kind']> = {}): Resolve {
  return (_target, prop) => {
    if (!Object.prototype.hasOwnProperty.call(node, prop)) return null;
    return { obj: node, key: prop, kind: kinds[prop] ?? 'number' };
  };
}

/** Channels of a rendered colour, whether GSAP emitted `#rrggbb`, `#rgb` or `rgba(r,g,b,a)`. */
function channels(value: string): number[] {
  if (value.charAt(0) === '#') {
    const hex = value.length === 4 ? value.slice(1).split('').map((c) => c + c).join('') : value.slice(1);
    return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  }
  const match = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(value);
  if (!match) return [];
  return [match[1], match[2], match[3]].map(Number);
}

describe('compileTweens', () => {
  it('interpolates a single tween and holds its from value before it starts', () => {
    const clock = makeClock();
    const node = { x: 0 };
    const tweens: Tween[] = [{ at: 1, duration: 2, ease: 'none', to: { x: 100 } }];

    const result = compileTweens(clock.timeline, tweens, { layerStart: 0, resolve: resolver(node), layerId: 'a' });
    expect(result).toEqual({ added: 1, errors: [] });

    primeTimeline(clock.timeline);
    expect(clock.time).toBe(0);

    clock.seek(0);
    expect(node.x).toBe(0);
    clock.seek(2);
    expect(node.x).toBe(50);
    clock.seek(3);
    expect(node.x).toBe(100);
    clock.seek(0.5);
    expect(node.x).toBe(0);
    clock.seek(2);
    expect(node.x).toBe(50);
  });

  it('keeps two tweens on one key deterministic whatever the seek order', () => {
    const clock = makeClock();
    const node = { x: 0 };
    const tweens: Tween[] = [
      { at: 0, duration: 1, ease: 'none', to: { x: 100 } },
      { at: 2, duration: 1, ease: 'none', from: { x: 100 }, to: { x: 0 } },
    ];
    compileTweens(clock.timeline, tweens, { layerStart: 0, resolve: resolver(node), layerId: 'a' });
    primeTimeline(clock.timeline);

    clock.seek(2.5);
    expect(node.x).toBe(50);
    clock.seek(0.5);
    expect(node.x).toBe(50);
    clock.seek(2.5);
    expect(node.x).toBe(50);
  });

  it('renders the from state at t = 0 after priming', () => {
    const clock = makeClock();
    const node = { alpha: 1 };
    const tweens: Tween[] = [{ at: 0, duration: 1, ease: 'none', from: { alpha: 0 }, to: { alpha: 1 } }];
    compileTweens(clock.timeline, tweens, { layerStart: 0, resolve: resolver(node), layerId: 'a' });

    primeTimeline(clock.timeline, 0);
    expect(node.alpha).toBe(0);
  });

  it('converts degrees to radians', () => {
    const clock = makeClock();
    const node = { rotation: 0 };
    const tweens: Tween[] = [{ at: 0, duration: 1, ease: 'none', to: { rotation: 90 } }];
    compileTweens(clock.timeline, tweens, { layerStart: 0, resolve: resolver(node, { rotation: 'deg' }), layerId: 'a' });
    primeTimeline(clock.timeline);

    clock.seek(1);
    // GSAP's plain-number renderer rounds every write to 6 decimals, so PI/2 lands at
    // 1.570796 (diff ~3.3e-7). 1e-9 is unattainable for a directly tweened value.
    expect(Math.abs(node.rotation - Math.PI / 2)).toBeLessThan(1e-6);
  });

  it('skips a tween whose target does not resolve and reports one error', () => {
    const clock = makeClock();
    const node = { x: 0 };
    const tweens: Tween[] = [{ at: 0, duration: 1, ease: 'none', to: { x: 5, rotation: 10 } }];

    const result = compileTweens(clock.timeline, tweens, { layerStart: 0, resolve: resolver(node), layerId: 'card' });

    expect(result.added).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('card');
    expect(result.errors[0]).toContain('rotation');

    primeTimeline(clock.timeline);
    clock.seek(1);
    expect(node.x).toBe(0);
  });

  it('offsets a tween by the layer start', () => {
    const clock = makeClock();
    const node = { x: 0 };
    const tweens: Tween[] = [{ at: 1, duration: 1, ease: 'none', to: { x: 10 } }];
    compileTweens(clock.timeline, tweens, { layerStart: 2, resolve: resolver(node), layerId: 'a' });

    const starts = clock.timeline.getChildren().map((child) => child.startTime());
    expect(starts.some((start) => Math.abs(start - 3) < 1e-9)).toBe(true);

    primeTimeline(clock.timeline);
    clock.seek(2.9);
    expect(node.x).toBe(0);
    clock.seek(3.5);
    expect(node.x).toBe(5);
    clock.seek(4);
    expect(node.x).toBe(10);
  });

  it('tweens a colour through a proxy and writes the value back on every seek', () => {
    const clock = makeClock();
    const node = { fill: '#000000' };
    let last = '#000000';
    const resolve: Resolve = (_target, prop) => {
      if (prop !== 'fill') return null;
      return {
        obj: node,
        key: 'fill',
        kind: 'color',
        setColor: (hex) => {
          last = hex;
        },
        getColor: () => node.fill,
      };
    };
    const tweens: Tween[] = [{ at: 0, duration: 2, ease: 'none', to: { fill: '#ffffff' } }];

    const result = compileTweens(clock.timeline, tweens, { layerStart: 0, resolve, layerId: 'a' });
    expect(result).toEqual({ added: 1, errors: [] });

    primeTimeline(clock.timeline);
    clock.seek(1);
    const mid = channels(last);
    expect(mid).toHaveLength(3);
    for (const channel of mid) expect([127, 128]).toContain(channel);

    clock.seek(0);
    expect(last).toBe('#000000');
  });

  it('honours repeat and yoyo', () => {
    const clock = makeClock();
    const node = { x: 0 };
    const tweens: Tween[] = [{ at: 0, duration: 1, ease: 'none', to: { x: 10 }, repeat: 1, yoyo: true }];
    compileTweens(clock.timeline, tweens, { layerStart: 0, resolve: resolver(node), layerId: 'a' });
    primeTimeline(clock.timeline);

    clock.seek(1);
    expect(node.x).toBe(10);
    clock.seek(2);
    expect(node.x).toBe(0);
  });
});
