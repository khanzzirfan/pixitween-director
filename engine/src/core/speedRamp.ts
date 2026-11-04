// Speed ramps: a shot's time is remapped by a speed curve (slow motion that snaps back to full speed). The curve is a list of
// points (`at` is the share of the shot, `rate` the speed there: 1 normal, 0.2 a fifth, 2 double) joined by straight lines.
// The shot still starts and ends where it did, so the cuts do not move; only the way it gets there changes. Pure and closed-form:
// the same time gives the same progress, so a seek, a preview and an export agree.

export interface RatePoint {
  at: number;
  rate: number;
}

/** The slowest and fastest a ramp may go (a rate of 0 would freeze the shot and make the curve impossible to invert). */
export const RATE_MIN = 0.05;
export const RATE_MAX = 4;

/** The curve with its ends: points sorted by `at`, rates held in range, and a point at 0 and at 1 (each end keeps the rate of its nearest point). */
export function rampCurve(points: readonly RatePoint[]): RatePoint[] {
  const pts = points
    .filter((p) => Number.isFinite(p.at) && Number.isFinite(p.rate))
    .map((p) => ({ at: Math.min(1, Math.max(0, p.at)), rate: Math.min(RATE_MAX, Math.max(RATE_MIN, p.rate)) }))
    .sort((a, b) => a.at - b.at);
  if (!pts.length) return [{ at: 0, rate: 1 }, { at: 1, rate: 1 }];
  if (pts[0]!.at > 0) pts.unshift({ at: 0, rate: pts[0]!.rate });
  if (pts.at(-1)!.at < 1) pts.push({ at: 1, rate: pts.at(-1)!.rate });
  return pts;
}

/** The distance covered (the integral of the rate) at each point of the curve. */
function covered(curve: readonly RatePoint[]): number[] {
  const out = [0];
  for (let i = 1; i < curve.length; i++) {
    const a = curve[i - 1]!;
    const b = curve[i]!;
    out.push(out[i - 1]! + ((a.rate + b.rate) / 2) * (b.at - a.at));
  }
  return out;
}

/** The distance covered by share `u` of the shot, along an already-built curve. */
function coveredAt(curve: readonly RatePoint[], cum: readonly number[], u: number): number {
  if (u <= 0) return 0;
  if (u >= 1) return cum.at(-1)!;
  let i = 1;
  while (i < curve.length - 1 && curve[i]!.at < u) i++;
  const a = curve[i - 1]!;
  const b = curve[i]!;
  const span = b.at - a.at;
  if (span <= 0) return cum[i - 1]!;
  const x = u - a.at;
  return cum[i - 1]! + a.rate * x + ((b.rate - a.rate) * x * x) / (2 * span);
}

/** How far through its motion the shot is (0 to 1) when `u` (0 to 1) of its time has passed. 0 at 0, 1 at 1, and never backwards. */
export function rampProgress(points: readonly RatePoint[], u: number): number {
  const curve = rampCurve(points);
  const cum = covered(curve);
  return coveredAt(curve, cum, u) / cum.at(-1)!;
}

/** The inverse: the share of the shot's time at which its motion has reached progress `w`. */
export function rampTime(points: readonly RatePoint[], w: number): number {
  if (w <= 0) return 0;
  if (w >= 1) return 1;
  const curve = rampCurve(points);
  const cum = covered(curve);
  const total = cum.at(-1)!;
  let lo = 0;
  let hi = 1;
  for (let n = 0; n < 40; n++) {
    const mid = (lo + hi) / 2;
    if (coveredAt(curve, cum, mid) / total < w) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** A ramp over a stretch of the clock, in seconds. */
export interface TimeWarpSpan {
  from: number;
  to: number;
  rates: RatePoint[];
}

/** The clock the world's own motion (liquids, smoke, swarms, life) reads at layer time `t`: inside a span it runs on the span's curve and meets the real clock at both ends. */
export function warpClock(spans: readonly TimeWarpSpan[] | undefined, t: number): number {
  if (!spans) return t;
  const span = spans.find((s) => t > s.from && t < s.to);
  if (!span) return t;
  const length = span.to - span.from;
  return span.from + length * rampProgress(span.rates, (t - span.from) / length);
}
