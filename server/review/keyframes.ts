/** True for a keyframed transform value (an array of keyframe objects) as opposed to a static [x, y] pair. */
export const isKeyframed = (v: unknown): boolean =>
  Array.isArray(v) && v.length > 0 && typeof v[0] === 'object' && v[0] !== null && !Array.isArray(v[0]);
