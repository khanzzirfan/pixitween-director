import { EASE_HANDLES } from './constants';
import { AuthoringError } from './errors';
import type { Ease } from './types';
import { secToFrames } from './units';

export type Handles = [number, number, number, number];
export type Kf<T> = { t: number; v: T; easeOut?: Handles };
export type Vec2 = [number, number];

/** CSS-style cubic bezier through (0,0) and (1,1); solves x(t) = x with 8 Newton steps, then returns y(t). */
export function cubicBezierEase(h: Handles, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const [x1, y1, x2, y2] = h;
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const X = (t: number) => ((ax * t + bx) * t + cx) * t;
  const dX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  let t = x;
  for (let i = 0; i < 8; i++) {
    const err = X(t) - x;
    const d = dX(t);
    if (Math.abs(err) < 1e-9 || Math.abs(d) < 1e-9) break;
    t -= err / d;
  }
  return ((ay * t + by) * t + cy) * t;
}

export const isAnimated = (field: unknown): field is Kf<unknown>[] => Array.isArray(field) && field.length > 0 && typeof field[0] === 'object' && field[0] !== null && !Array.isArray(field[0]);

/** Position of `frame` within the segment starting at key i: eased 0..1 progress. */
function segment<T>(keys: Kf<T>[], frame: number): { a: Kf<T>; b: Kf<T>; p: number } | { only: Kf<T> } {
  if (frame <= keys[0]!.t) return { only: keys[0]! };
  const last = keys[keys.length - 1]!;
  if (frame >= last.t) return { only: last };
  let i = 0;
  while (keys[i + 1]!.t <= frame) i++;
  const a = keys[i]!;
  const b = keys[i + 1]!;
  const raw = (frame - a.t) / (b.t - a.t);
  return { a, b, p: a.easeOut ? cubicBezierEase(a.easeOut, raw) : raw };
}

export function sampleScalar(field: number | Kf<number>[] | undefined, fallback: number, frame: number): number {
  if (field === undefined) return fallback;
  if (!isAnimated(field)) return field as number;
  const s = segment(field as Kf<number>[], frame);
  return 'only' in s ? s.only.v : s.a.v + (s.b.v - s.a.v) * s.p;
}

export function sampleVec2(field: Vec2 | Kf<Vec2>[] | undefined, fallback: Vec2, frame: number): Vec2 {
  if (field === undefined) return fallback;
  if (!isAnimated(field)) return field as Vec2;
  const s = segment(field as Kf<Vec2>[], frame);
  if ('only' in s) return s.only.v;
  return [s.a.v[0] + (s.b.v[0] - s.a.v[0]) * s.p, s.a.v[1] + (s.b.v[1] - s.a.v[1]) * s.p];
}

/** Seconds from the scene start -> engine keyframes (frames). The ease is written as the easeOut handle of every key but the last. */
export function buildKeys(
  keys: Array<[number, number]>,
  ease: Ease,
  fps: number,
  sceneFrames: number,
  o: { min?: number; max?: number } = {},
): Kf<number>[] {
  const sceneSec = sceneFrames / fps;
  const out: Kf<number>[] = [];
  keys.forEach(([sec, v], i) => {
    if (!Number.isFinite(sec) || !Number.isFinite(v)) throw new AuthoringError('bad_value', `key ${i} must be finite numbers [seconds, value]`);
    if (i > 0 && sec <= keys[i - 1]![0]) throw new AuthoringError('bad_value', 'keys must be ascending in time');
    if (sec < 0 || sec > sceneSec) throw new AuthoringError('time_out_of_range', `key time ${sec}s is outside the scene (0 to ${sceneSec}s)`, `The scene is ${sceneSec}s long`);
    if ((o.min !== undefined && v < o.min) || (o.max !== undefined && v > o.max)) {
      throw new AuthoringError('bad_value', `value ${v} is outside ${o.min ?? '-inf'}..${o.max ?? 'inf'}`);
    }
    const t = secToFrames(sec, fps);
    if (out.length && out[out.length - 1]!.t === t) throw new AuthoringError('keys_too_close', `keys at ${keys[i - 1]![0]}s and ${sec}s land on the same frame`, 'Keep keys at least 1/30 s apart');
    out.push({ t, v });
  });
  const handle = EASE_HANDLES[ease];
  if (handle) for (let i = 0; i < out.length - 1; i++) out[i]!.easeOut = [...handle];
  return out;
}
