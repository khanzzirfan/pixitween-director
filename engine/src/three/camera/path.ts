import type { CameraPath, CameraPathKey } from '../../schema/layer3d';
import { DEFAULT_SHOT_FOV, type Vec3 } from './frameShot';

// A camera path is a list of keys the camera passes through. It is sampled statelessly: the same
// local time always gives the same pose, so a seek to 1 s, then 0, then 1 s ends where it began.
// Nothing is integrated frame by frame, and no GSAP tween touches the camera while a path is set.

export interface PathSample {
  position: Vec3;
  lookAt: Vec3;
  fov: number;
}

function lerp(a: number, b: number, u: number): number {
  return a + (b - a) * u;
}

function lerpVec(a: Vec3, b: Vec3, u: number): Vec3 {
  return [lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u)];
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function scale(a: Vec3, k: number): Vec3 {
  return [a[0] * k, a[1] * k, a[2] * k];
}

/** The mirror of `b` through `a`: the phantom point that continues the curve past its end. */
function phantom(a: Vec3, b: Vec3): Vec3 {
  return [2 * a[0] - b[0], 2 * a[1] - b[1], 2 * a[2] - b[2]];
}

/**
 * The Hermite basis of a Catmull-Rom segment: `C = h00 P1 + h10 m1 + h01 P2 + h11 m2`.
 * At `u = 0` it is exactly `P1` and at `u = 1` exactly `P2`, so a key's own values come back
 * untouched.
 */
function hermite(p1: Vec3, m1: Vec3, p2: Vec3, m2: Vec3, u: number): Vec3 {
  const u2 = u * u;
  const u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1;
  const h10 = u3 - 2 * u2 + u;
  const h01 = -2 * u3 + 3 * u2;
  const h11 = u3 - u2;
  return [
    h00 * p1[0] + h10 * m1[0] + h01 * p2[0] + h11 * m2[0],
    h00 * p1[1] + h10 * m1[1] + h01 * p2[1] + h11 * m2[1],
    h00 * p1[2] + h10 * m1[2] + h01 * p2[2] + h11 * m2[2],
  ];
}

/**
 * One Catmull-Rom segment of a curve of the path's keys. The phantom points at the ends mirror
 * their neighbour, so the spline starts and ends with the tangent of the first (or last) segment
 * instead of a flat stop. The tangents are scaled by the segment's own length, so unevenly spaced
 * keys keep their speed.
 */
function catmullRom(keys: CameraPathKey[], field: 'position' | 'lookAt', index: number, u: number): Vec3 {
  const p1 = keys[index][field];
  const p2 = keys[index + 1][field];
  const k1 = keys[index].t;
  const k2 = keys[index + 1].t;
  const p0 = index > 0 ? keys[index - 1][field] : phantom(p1, p2);
  const p3 = index + 2 < keys.length ? keys[index + 2][field] : phantom(p2, p1);
  const k0 = index > 0 ? keys[index - 1].t : k1 - (k2 - k1);
  const k3 = index + 2 < keys.length ? keys[index + 2].t : k2 + (k2 - k1);
  const span = k2 - k1;
  const m1 = scale(sub(p2, p0), span / (k2 - k0));
  const m2 = scale(sub(p3, p1), span / (k3 - k1));
  return hermite(p1, m1, p2, m2, u);
}

/**
 * The key's lens. A key that says nothing about the fov holds the value of the last key that did
 * (`fallbackFov` before the first one), so a path can change the lens once and keep it.
 */
function effectiveFovs(keys: CameraPathKey[], fallbackFov: number): number[] {
  const out: number[] = [];
  let carried = fallbackFov;
  for (const key of keys) {
    if (key.fov !== undefined) carried = key.fov;
    out.push(carried);
  }
  return out;
}

/**
 * Sample a camera path at `localSec` (layer-local seconds).
 *
 * `linear` moves in straight lines between the keys; `smooth` runs a Catmull-Rom spline through
 * them. Both are clamped at the ends: before the first key the camera holds the first key's pose,
 * after the last key the last one. The lens is interpolated in a straight line between the keys.
 */
export function samplePath(path: CameraPath, localSec: number, fallbackFov: number = DEFAULT_SHOT_FOV): PathSample {
  const keys = path.keys;
  const first = keys[0];
  const last = keys[keys.length - 1];
  const fovs = effectiveFovs(keys, fallbackFov);

  // Clamped at the ends: the path holds its first (or last) pose outside its own span.
  if (localSec <= first.t) {
    return { position: [...first.position] as Vec3, lookAt: [...first.lookAt] as Vec3, fov: fovs[0] };
  }
  if (localSec >= last.t) {
    return { position: [...last.position] as Vec3, lookAt: [...last.lookAt] as Vec3, fov: fovs[fovs.length - 1] };
  }

  // The segment that holds `localSec`.
  let index = 0;
  while (index < keys.length - 2 && localSec > keys[index + 1].t) index += 1;
  const a = keys[index];
  const b = keys[index + 1];
  const span = b.t - a.t;
  const u = span > 0 ? (localSec - a.t) / span : 0;

  // The lens travels in a straight line between the keys.
  const fov = lerp(fovs[index], fovs[index + 1], u);

  if (path.curve === 'linear') {
    return {
      position: lerpVec(a.position, b.position, u),
      lookAt: lerpVec(a.lookAt, b.lookAt, u),
      fov,
    };
  }

  return {
    position: catmullRom(keys, 'position', index, u),
    lookAt: catmullRom(keys, 'lookAt', index, u),
    fov,
  };
}
