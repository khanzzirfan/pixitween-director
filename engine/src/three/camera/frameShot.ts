// Shot vocabulary (sizes, levels, sides) and framing math are ours; engine/docs/09-camera.md is the contract.
import type * as THREE from 'three';
import { SHOT_ANGLES, SHOT_SIDES, SHOT_SIZES, type ShotSpec } from '../../schema/layer3d';
import { directionFromAzimuthElevation } from '../build/lighting';

// Framing a shot by film vocabulary instead of by numbers: "medium, low angle, right three-quarter"
// becomes a camera pose. The function is pure: a shot spec, the subject's world box and the frame
// aspect in, a camera position, a lookAt and a field of view out.

/** `[x, y, z]` in world units (engine/docs/01-schema.md, `Vec3`). */
export type Vec3 = [number, number, number];

// The vocabulary lives in the schema (it is what an author writes); it is re-exported here so the
// camera module and the schema never drift apart.
export { SHOT_ANGLES, SHOT_SIDES, SHOT_SIZES };
export type { ShotSpec };

export type ShotSize = (typeof SHOT_SIZES)[number];

export type ShotAngle = (typeof SHOT_ANGLES)[number];

export type ShotSide = (typeof SHOT_SIDES)[number];

export interface FramedShot {
  position: Vec3;
  lookAt: Vec3;
  fov: number;
}

/**
 * `fill` is the fraction of the frame height the subject fills; `visible` is the fraction of the
 * subject the shot frames. A wide shot frames the whole subject; a close-up frames the top of it
 * (head and shoulders), so it measures less and stands closer.
 */
const SIZE_TABLE: Record<ShotSize, { fill: number; visible: number }> = {
  extremeWide: { fill: 0.2, visible: 1 },
  wide: { fill: 0.45, visible: 1 },
  medium: { fill: 0.8, visible: 0.6 },
  closeUp: { fill: 1.6, visible: 0.3 },
  extremeCloseUp: { fill: 3, visible: 0.15 },
};

/** Degrees above the horizon of the camera, relative to the lookAt. */
const ANGLE_ELEVATIONS: Record<ShotAngle, number> = {
  eye: 0,
  low: -20,
  high: 25,
  overhead: 80,
};

/** Degrees around the vertical axis, from the subject's facing (+z). Negative is the object's left. */
const SIDE_AZIMUTHS: Record<ShotSide, number> = {
  front: 0,
  left3q: -35,
  right3q: 35,
  leftProfile: -90,
  rightProfile: 90,
  back: 180,
};

export const DEFAULT_SHOT_FOV = 35;

export const DEFAULT_SHOT_ASPECT = 16 / 9;

/**
 * Frame a shot of the subject's box.
 *
 * The distance follows the doc: `d = (h × visibleFraction) / (2 tan(fov / 2) × size)`, where `h` is
 * the subject height (the width scaled by the aspect ratio for a subject wider than it is tall) and
 * `size` is the fraction of the frame height the subject fills.
 */
export function frameShot(shot: ShotSpec, box: THREE.Box3, aspect: number = DEFAULT_SHOT_ASPECT): FramedShot {
  const { fill, visible } = SIZE_TABLE[shot.size];
  const elevation = ANGLE_ELEVATIONS[shot.angle ?? 'eye'];
  const azimuth = SIDE_AZIMUTHS[shot.side ?? 'front'];
  const fov = shot.fov ?? DEFAULT_SHOT_FOV;

  const boxHeight = box.max.y - box.min.y;
  const boxWidth = box.max.x - box.min.x;
  // A subject wider than it is tall is measured through its width: the frame height that width
  // needs is the width scaled by the aspect ratio.
  const widthAsHeight = boxWidth / aspect;
  const tall = boxHeight >= widthAsHeight;

  const subjectHeight = tall ? boxHeight : widthAsHeight;
  // Only a tall subject has a top to frame, so a wide subject is always shot whole.
  const visibleHeight = tall ? visible : 1;

  const distance = (subjectHeight * visibleHeight) / (2 * Math.tan((fov * Math.PI) / 360) * fill);

  // The lookAt is the centre of the framed part: the whole box for a wide shot, the upper part of
  // the box for a close-up (a medium shot looks at 70 % of the height, a close-up at 85 %).
  const lookAtY = tall ? box.max.y - (visibleHeight * boxHeight) / 2 : (box.min.y + box.max.y) / 2;
  const lookAt: Vec3 = [(box.min.x + box.max.x) / 2, lookAtY, (box.min.z + box.max.z) / 2];

  const [dx, dy, dz] = directionFromAzimuthElevation(azimuth, elevation);
  const position: Vec3 = [lookAt[0] + dx * distance, lookAt[1] + dy * distance, lookAt[2] + dz * distance];

  return { position, lookAt, fov };
}
