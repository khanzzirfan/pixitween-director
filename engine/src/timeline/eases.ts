// AEP keyframe eases arrive as cubic-bezier control points (engine/docs/10-aep-adapter.md, "Keyframes →
// tweens", R7 US-001). GSAP's own CustomEase plugin is a paid/club add-on we don't depend on (see
// engine/docs/02-timeline.md), so a tiny pure solver plus a plain `gsap.EaseFunction` stands in for it.

const NEWTON_ITERATIONS = 8;
const NEWTON_EPSILON = 1e-7;
const SUBDIVISION_PRECISION = 1e-7;
const SUBDIVISION_MAX_ITERATIONS = 20;

function a(x1: number, x2: number): number {
  return 1 - 3 * x2 + 3 * x1;
}

function b(x1: number, x2: number): number {
  return 3 * x2 - 6 * x1;
}

function c(x1: number): number {
  return 3 * x1;
}

/** Cubic bezier value at `t` for one axis, given its two control coordinates. */
function calcBezier(t: number, x1: number, x2: number): number {
  return ((a(x1, x2) * t + b(x1, x2)) * t + c(x1)) * t;
}

/** d/dt of `calcBezier`, used by the Newton-Raphson step. */
function getSlope(t: number, x1: number, x2: number): number {
  return 3 * a(x1, x2) * t * t + 2 * b(x1, x2) * t + c(x1);
}

/**
 * Solves `calcBezier(t, x1, x2) = x` for `t`, matching the standard CSS `cubic-bezier()` algorithm
 * (WebKit's `UnitBezier`): Newton-Raphson first, falling back to bisection if the slope is too flat.
 */
function solveCurveX(x: number, x1: number, x2: number): number {
  let t = x;
  for (let i = 0; i < NEWTON_ITERATIONS; i += 1) {
    const slope = getSlope(t, x1, x2);
    if (Math.abs(slope) < NEWTON_EPSILON) break;
    const current = calcBezier(t, x1, x2) - x;
    t -= current / slope;
  }

  let lower = 0;
  let upper = 1;
  t = x;
  for (let i = 0; i < SUBDIVISION_MAX_ITERATIONS; i += 1) {
    const current = calcBezier(t, x1, x2) - x;
    if (Math.abs(current) < SUBDIVISION_PRECISION) return t;
    if (current > 0) {
      upper = t;
    } else {
      lower = t;
    }
    t = (lower + upper) / 2;
  }
  return t;
}

/**
 * A CSS/AE-style cubic-bezier easing curve through `(0,0)`, `(x1,y1)`, `(x2,y2)`, `(1,1)`. `x1`/`x2`
 * are clamped to `[0, 1]` so the curve stays a function of `t` (required for the Newton/bisection
 * solve above); `y1`/`y2` are unclamped, matching AE and the CSS spec, which both allow bounce-past
 * overshoot on the y axis.
 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const cx1 = Math.min(1, Math.max(0, x1));
  const cx2 = Math.min(1, Math.max(0, x2));

  if (cx1 === y1 && cx2 === y2) {
    return (t: number) => t;
  }

  return (t: number): number => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    const x = solveCurveX(t, cx1, cx2);
    return calcBezier(x, y1, y2);
  };
}

const CUBIC_CALL_PATTERN = /^cubic\(([^)]*)\)$/;

/** Parses `cubic(x1,y1,x2,y2)` into its four numbers, or `null` if `value` is not that shape. */
export function parseCubicArgs(value: string): [number, number, number, number] | null {
  const match = CUBIC_CALL_PATTERN.exec(value.trim());
  if (!match) return null;
  const parts = match[1].split(',').map((part) => part.trim());
  if (parts.length !== 4 || parts.some((part) => part === '')) return null;
  const nums = parts.map(Number);
  if (nums.some((n) => !Number.isFinite(n))) return null;
  return nums as [number, number, number, number];
}

/**
 * Resolves a schema `Ease` string to what GSAP's `ease` tween var expects: `cubic(x1,y1,x2,y2)`
 * becomes a plain easing function, every other ease string (GSAP's own names) passes through
 * unchanged. `undefined` stays `undefined` so callers keep their own default.
 */
export function resolveEase(ease: string | undefined): string | ((t: number) => number) | undefined {
  if (ease === undefined) return undefined;
  const args = parseCubicArgs(ease);
  if (!args) return ease;
  return cubicBezier(...args);
}
