// AEP property → MotionDoc initial value + tweens. See engine/docs/10-aep-adapter.md
// ("Time" and "Keyframes → tweens") for the conversion rules this implements.
import type { AepAnimatable, AepEaseHandle, AepKeyframe } from '@shared/aep/transform';

export type AepPropertyValue = number | number[];

export interface PropertyTweensOptions {
  fps: number;
  inPoint: number;
  props: string[];
}

export interface ConvertedTween {
  at: number;
  duration: number;
  from: Record<string, number>;
  to: Record<string, number>;
  ease: string;
}

export interface ConvertedProperty {
  initial: Record<string, number>;
  tweens: ConvertedTween[];
}

/** Rounds away floating-point drift from frame/fps division without changing the intended value. */
function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function round4(value: number): number {
  return Math.round(value * 1e4) / 1e4;
}

function isVector(value: AepPropertyValue): value is number[] {
  return Array.isArray(value);
}

function zipProps(value: AepPropertyValue, props: string[]): Record<string, number> {
  if (isVector(value)) {
    return props.reduce<Record<string, number>>((acc, prop, i) => {
      acc[prop] = value[i];
      return acc;
    }, {});
  }
  return { [props[0]]: value };
}

/** True when `value` is an array of keyframes rather than a constant (a constant may itself be a vector array). */
export function isKeyframed<T>(value: AepAnimatable<T>): value is AepKeyframe<T>[] {
  return Array.isArray(value) && value.every((item) => item !== null && typeof item === 'object' && 't' in item && 'v' in item);
}

/**
 * Ease for the tween between two keyframes: the cubic-bezier of `k0.easeOut` (all four handles), or
 * `none` without one. `k1.easeIn` is not read: the reacthub-pixitweenjs sampler these films were made
 * on eases a segment by its first key's out-handle alone, and a converted film must move the same way.
 */
export function easeFor(k0: AepKeyframe<unknown>, _k1: AepKeyframe<unknown>): string {
  if (!k0.easeOut) return 'none';
  const [x1, y1, x2, y2]: AepEaseHandle = k0.easeOut;
  return `cubic(${round4(x1)},${round4(y1)},${round4(x2)},${round4(y2)})`;
}

/**
 * Turns an AEP property (constant or keyframe array) into a MotionDoc initial value plus the
 * tweens needed to animate it, per `props` (e.g. `['x','y']` for position, `['alpha']` for opacity).
 */
export function propertyTweens(value: AepAnimatable<AepPropertyValue>, options: PropertyTweensOptions): ConvertedProperty {
  const { fps, inPoint, props } = options;

  if (!isKeyframed(value)) {
    return { initial: zipProps(value, props), tweens: [] };
  }

  const initial = zipProps(value[0].v, props);
  const tweens: ConvertedTween[] = [];

  for (let i = 0; i < value.length - 1; i++) {
    const k0 = value[i];
    const k1 = value[i + 1];
    if (k1.t === k0.t) continue; // zero-length pair is skipped

    if (k0.hold) {
      // A hold key keeps its value until the next key, then jumps: one instant tween at the next key.
      tweens.push({
        at: Math.max(0, round((k1.t - inPoint) / fps)),
        duration: 0,
        from: zipProps(k0.v, props),
        to: zipProps(k1.v, props),
        ease: 'none',
      });
      continue;
    }

    const at = Math.max(0, round((k0.t - inPoint) / fps));
    const duration = round((k1.t - k0.t) / fps);

    tweens.push({
      at,
      duration,
      from: zipProps(k0.v, props),
      to: zipProps(k1.v, props),
      ease: easeFor(k0, k1),
    });
  }

  return { initial, tweens };
}
