import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { applyRig, type RestPose, type RigOffsets } from './rig';

// The rig moves a camera in film words. The tests read the camera's own axes at the rest pose, so
// they check the moves against the pose rather than against numbers the implementation chose.

const REST: RestPose = {
  position: new THREE.Vector3(0, 1, 6),
  lookAt: new THREE.Vector3(0, 1, 0),
};

function makeCamera(rest: RestPose = REST): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(35, 16 / 9, 0.1, 200);
  camera.position.copy(rest.position);
  camera.lookAt(rest.lookAt);
  return camera;
}

function offsets(partial: Partial<RigOffsets> = {}): RigOffsets {
  return { pan: 0, tilt: 0, roll: 0, dolly: 0, truck: 0, pedestal: 0, ...partial };
}

/** The camera's own right and up axes at the rest pose. */
function restAxesOf(camera: THREE.Camera): { right: THREE.Vector3; up: THREE.Vector3 } {
  return {
    right: new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion),
    up: new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion),
  };
}

const DEG = 180 / Math.PI;

describe('applyRig', () => {
  it('dolly 1 moves the camera 1 m along its view direction and changes no rotation', () => {
    const camera = makeCamera();
    const before = camera.getWorldDirection(new THREE.Vector3());
    const rotation = camera.quaternion.clone();

    applyRig(camera, REST, offsets({ dolly: 1 }));

    const moved = camera.position.clone().sub(REST.position);
    expect(moved.length()).toBeCloseTo(1, 9);
    expect(moved.distanceTo(before)).toBeLessThan(1e-6);
    expect(camera.quaternion.angleTo(rotation)).toBeLessThan(1e-9);
  });

  it('dolly -1 moves the camera back along the view direction', () => {
    const camera = makeCamera();
    applyRig(camera, REST, offsets({ dolly: -1 }));
    expect(camera.position.toArray()).toEqual([0, 1, 7]);
  });

  it('pan 90 turns the view direction by 90 degrees around the camera up axis', () => {
    const camera = makeCamera();
    const before = camera.getWorldDirection(new THREE.Vector3());
    const up = restAxesOf(camera).up;

    applyRig(camera, REST, offsets({ pan: 90 }));

    const after = camera.getWorldDirection(new THREE.Vector3());
    expect(after.angleTo(before) * DEG).toBeCloseTo(90, 6);
    // The turn is around the up axis: the up axis itself does not move.
    expect(restAxesOf(camera).up.distanceTo(up)).toBeLessThan(1e-9);
  });

  it('setting pan back to 0 restores the rest pose exactly', () => {
    const camera = makeCamera();
    const restRotation = camera.quaternion.clone();

    applyRig(camera, REST, offsets({ pan: 90 }));
    applyRig(camera, REST, offsets({ pan: 0 }));

    expect(camera.position.toArray()).toEqual(REST.position.toArray());
    expect(camera.quaternion.equals(restRotation)).toBe(true);
  });

  it('truck 1 then pedestal 1 move the camera 1 m along its right and up axes', () => {
    const camera = makeCamera();
    const { right, up } = restAxesOf(camera);

    applyRig(camera, REST, offsets({ truck: 1, pedestal: 1 }));

    const moved = camera.position.clone().sub(REST.position);
    expect(moved.distanceTo(right.clone().add(up))).toBeLessThan(1e-6);
    expect(moved.dot(right)).toBeCloseTo(1, 9);
    expect(moved.dot(up)).toBeCloseTo(1, 9);
  });

  it('truck and pedestal keep their axes when the camera pans', () => {
    const camera = makeCamera();
    const { right, up } = restAxesOf(camera);

    applyRig(camera, REST, offsets({ truck: 1, pedestal: 1, pan: 45 }));

    const moved = camera.position.clone().sub(REST.position);
    expect(moved.distanceTo(right.clone().add(up))).toBeLessThan(1e-6);
  });

  it('tilt lifts the view without moving the camera', () => {
    const camera = makeCamera();
    const before = camera.getWorldDirection(new THREE.Vector3());

    applyRig(camera, REST, offsets({ tilt: 5 }));

    const after = camera.getWorldDirection(new THREE.Vector3());
    expect(after.angleTo(before) * DEG).toBeCloseTo(5, 6);
    expect(after.y).toBeGreaterThan(0);
    expect(camera.position.toArray()).toEqual(REST.position.toArray());
  });

  it('roll turns the camera about the optical axis and keeps the view direction', () => {
    const camera = makeCamera();
    const before = camera.getWorldDirection(new THREE.Vector3());
    const right = restAxesOf(camera).right;

    applyRig(camera, REST, offsets({ roll: 30 }));

    expect(camera.getWorldDirection(new THREE.Vector3()).distanceTo(before)).toBeLessThan(1e-9);
    // The camera's right axis has swung 30 degrees up.
    const rolled = restAxesOf(camera).right;
    expect(rolled.angleTo(right) * DEG).toBeCloseTo(30, 6);
    expect(rolled.y).toBeGreaterThan(0);
  });

  it('composes the offsets: dolly in, truck right and pedestal up at once', () => {
    const camera = makeCamera();
    const { right, up } = restAxesOf(camera);
    const forward = camera.getWorldDirection(new THREE.Vector3());

    applyRig(camera, REST, offsets({ dolly: 0.5, truck: 1, pedestal: 2 }));

    const moved = camera.position.clone().sub(REST.position);
    const expected = right.clone().multiplyScalar(1).add(up.clone().multiplyScalar(2)).add(forward.clone().multiplyScalar(0.5));
    expect(moved.distanceTo(expected)).toBeLessThan(1e-6);
  });

  it('leaves the camera alone when every offset is zero', () => {
    const camera = makeCamera();
    const position = camera.position.clone();
    const rotation = camera.quaternion.clone();

    applyRig(camera, REST, offsets());

    expect(camera.position.equals(position)).toBe(true);
    expect(camera.quaternion.equals(rotation)).toBe(true);
  });

  it('follows a rest pose that looks down, so the moves ride the tilted axes', () => {
    const rest: RestPose = {
      position: new THREE.Vector3(0, 4, 4),
      lookAt: new THREE.Vector3(0, 0, 0),
    };
    const camera = makeCamera(rest);
    const { right, up } = restAxesOf(camera);

    applyRig(camera, rest, offsets({ truck: 1, pedestal: 1 }));

    const moved = camera.position.clone().sub(rest.position);
    expect(moved.distanceTo(right.clone().add(up))).toBeLessThan(1e-6);
    // The camera looks down at 45 degrees, so its up axis is not the world up.
    expect(Math.abs(right.y)).toBeLessThan(1e-9);
    expect(up.y).toBeCloseTo(Math.SQRT1_2, 9);
  });
});
