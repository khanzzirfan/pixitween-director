// Camera-relative verbs (pan, tilt, roll, dolly, truck, pedestal). The maths is ours and stateless:
// the camera is recomputed from the rest pose plus the rig offsets on every update, so a seek never
// integrates anything. engine/docs/09-camera.md ("Rig targets") is the contract.
import * as THREE from 'three';

// A camera rig move in film words: the camera stands on its rest pose and the rig offsets move it
// from there. The offsets are absolute (not deltas), so a tween writes the value it means.

/** Where the camera stands and what it looks at before any rig offset is applied. */
export interface RestPose {
  position: THREE.Vector3;
  lookAt: THREE.Vector3;
}

export interface RigOffsets {
  /** Degrees about the camera's own up axis (positive turns the camera to its left). */
  pan: number;
  /** Degrees about the camera's own right axis (positive lifts the view). */
  tilt: number;
  /** Degrees about the optical axis (positive tips the camera's right side up). */
  roll: number;
  /** Metres along the view direction (positive dollies in, towards the subject). */
  dolly: number;
  /** Metres along the camera's right (positive trucks right). */
  truck: number;
  /** Metres along the camera's up (positive pedestals up). */
  pedestal: number;
}

export const ZERO_RIG_OFFSETS: RigOffsets = {
  pan: 0,
  tilt: 0,
  roll: 0,
  dolly: 0,
  truck: 0,
  pedestal: 0,
};

const DEG_TO_RAD = Math.PI / 180;

/** The world's up: the axis a camera hangs from. */
const WORLD_UP = new THREE.Vector3(0, 1, 0);
/** Used when the camera looks straight up or down and the world up cannot give a right axis. */
const FALLBACK_UP = new THREE.Vector3(0, 0, 1);

// The camera's own axes, in the camera's local space: x is its right, y its up, z its back.
const LOCAL_RIGHT = new THREE.Vector3(1, 0, 0);
const LOCAL_UP = new THREE.Vector3(0, 1, 0);
const LOCAL_BACK = new THREE.Vector3(0, 0, 1);

/**
 * The rest pose's own axes: where the camera looks and which way is right and up for it.
 *
 * `right` is the same axis the camera ends up with after `lookAt` (three.js builds it as
 * `cross(forward, up)`), so the translations ride exactly the axes the rotations turn about.
 */
function restAxes(rest: RestPose, fallbackForward: THREE.Vector3): { right: THREE.Vector3; up: THREE.Vector3; forward: THREE.Vector3 } {
  const forward = rest.lookAt.clone().sub(rest.position);
  if (forward.lengthSq() < 1e-18) {
    // The camera stands on its look-at point: keep the direction it already had.
    forward.copy(fallbackForward);
  } else {
    forward.normalize();
  }

  const right = new THREE.Vector3().crossVectors(forward, WORLD_UP);
  if (right.lengthSq() < 1e-18) {
    // Looking straight up or down: the world up cannot give a right axis.
    right.crossVectors(forward, FALLBACK_UP);
  }
  right.normalize();

  const up = new THREE.Vector3().crossVectors(right, forward).normalize();
  return { right, up, forward };
}

/**
 * Put the camera on its rest pose plus the rig offsets.
 *
 * The offsets compose in the order the film does: truck, pedestal and dolly ride the rest pose's
 * own axes (so they do not follow a pan), then pan, tilt and roll turn the camera about its own
 * axes. The rest orientation is resolved before the translation, so a dolly rides the optical axis
 * and changes no rotation — the subject keeps its size in frame, which is what a dolly is.
 */
export function applyRig(camera: THREE.Camera, rest: RestPose, offsets: RigOffsets): void {
  const fallback = camera.getWorldDirection(new THREE.Vector3());
  const { right, up, forward } = restAxes(rest, fallback);

  camera.position.copy(rest.position);
  if (rest.lookAt.distanceToSquared(rest.position) > 1e-18) camera.lookAt(rest.lookAt);

  camera.position.addScaledVector(right, offsets.truck);
  camera.position.addScaledVector(up, offsets.pedestal);
  camera.position.addScaledVector(forward, offsets.dolly);

  if (offsets.pan !== 0) camera.rotateOnAxis(LOCAL_UP, offsets.pan * DEG_TO_RAD);
  if (offsets.tilt !== 0) camera.rotateOnAxis(LOCAL_RIGHT, offsets.tilt * DEG_TO_RAD);
  if (offsets.roll !== 0) camera.rotateOnAxis(LOCAL_BACK, offsets.roll * DEG_TO_RAD);
}
