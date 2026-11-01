type Key<T> = { t: number; v: T; easeOut?: [number, number, number, number]; hold?: boolean };
export function cubicBezierEase(h: [number, number, number, number], x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const [x1, y1, x2, y2] = h;
  const sample = (t: number, a: number, b: number) => 3 * (1 - t) * (1 - t) * t * a + 3 * (1 - t) * t * t * b + t * t * t;
  let t = x;
  for (let i = 0; i < 8; i++) {
    const estimate = sample(t, x1, x2) - x;
    const d = 3 * (1 - t) * (1 - t) * x1 + 6 * (1 - t) * t * (x2 - x1) + 3 * t * t * (1 - x2);
    if (Math.abs(d) < 1e-7) break;
    t -= estimate / d;
  }
  return sample(Math.min(1, Math.max(0, t)), y1, y2);
}
export const lerpNumber = (a: number, b: number, t: number) => a + (b - a) * t;
export const lerpVec2 = (a: [number, number], b: [number, number], t: number): [number, number] => [
  lerpNumber(a[0], b[0], t),
  lerpNumber(a[1], b[1], t),
];
export function sampleAnimatable<T>(field: T | Key<T>[], fallback: T, frame: number, lerp: (a: T, b: T, t: number) => T): T {
  // a static vec2 is also an array, so only an array of {t, v} objects counts as keyframes
  const isKeys = Array.isArray(field) && field.length > 0 && typeof field[0] === 'object' && field[0] !== null && 't' in field[0];
  if (!isKeys) return (field as T) ?? fallback;
  const keys = field as Key<T>[];
  if (frame < keys[0]!.t) return keys[0]!.v;
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i]!,
      b = keys[i + 1]!;
    if (frame < b.t) {
      if (a.hold) return a.v;
      const raw = (frame - a.t) / (b.t - a.t);
      return lerp(a.v, b.v, a.easeOut ? cubicBezierEase(a.easeOut, raw) : raw);
    }
  }
  return keys[keys.length - 1]!.v;
}
export const sampleScalar = (field: number | Key<number>[], fallback: number, frame: number) =>
  sampleAnimatable(field, fallback, frame, lerpNumber);
export const sampleVec2 = (field: [number, number] | Key<[number, number]>[], fallback: [number, number], frame: number) =>
  sampleAnimatable(field, fallback, frame, lerpVec2);
