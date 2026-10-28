import { isAnimated, sampleScalar, sampleVec2, type Kf, type Vec2 } from './keyframes';

type PositionField = Vec2 | Kf<Vec2>[];

/** Keying one axis of the position vec2 keeps the other axis' values at every key time (design 5.4). */
export function mergePositionAxis(position: PositionField, axis: 'x' | 'y', newKeys: Kf<number>[], _fps: number): Kf<Vec2>[] {
  const existing = isAnimated(position) ? (position as Kf<Vec2>[]) : [];
  const frames = [...new Set([...newKeys.map((k) => k.t), ...existing.map((k) => k.t)])].sort((a, b) => a - b);
  const i = axis === 'x' ? 0 : 1;
  return frames.map((f) => {
    const other = sampleVec2(position, [0, 0], f);
    const own = sampleScalar(newKeys, newKeys[0]!.v, f);
    const v: Vec2 = i === 0 ? [own, other[1]] : [other[0], own];
    const ease = newKeys.find((k) => k.t === f)?.easeOut ?? existing.find((k) => k.t === f)?.easeOut;
    return { t: f, v, ...(ease ? { easeOut: ease } : {}) };
  });
}

/** Fixes one axis to a static value: a static position stays static; keyframes keep their other axis. */
export function replaceAxisWithStatic(position: PositionField, axis: 'x' | 'y', value: number): PositionField {
  const i = axis === 'x' ? 0 : 1;
  const set = (v: Vec2): Vec2 => (i === 0 ? [value, v[1]] : [v[0], value]);
  if (!isAnimated(position)) return set(position as Vec2);
  return (position as Kf<Vec2>[]).map((k) => ({ ...k, v: set(k.v) }));
}
