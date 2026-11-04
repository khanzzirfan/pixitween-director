import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { frameShot, type FramedShot, type ShotSpec, type Vec3 } from './frameShot';

// The box the doc's own test uses: a 0.6 x 1.8 x 0.6 can standing at the origin.
const CAN = new THREE.Box3(new THREE.Vector3(-0.3, -0.9, -0.3), new THREE.Vector3(0.3, 0.9, 0.3));
const ASPECT = 16 / 9;

function shot(overrides: Partial<ShotSpec> & Pick<ShotSpec, 'size'>): ShotSpec {
  return { subject: 'object:can', ...overrides };
}

/** The camera's offset from the lookAt, the direction it looks along. */
function offset(framed: FramedShot): Vec3 {
  return [
    framed.position[0] - framed.lookAt[0],
    framed.position[1] - framed.lookAt[1],
    framed.position[2] - framed.lookAt[2],
  ];
}

/** Degrees around the vertical axis, 0 at +z. */
function azimuthOf(framed: FramedShot): number {
  const [x, , z] = offset(framed);
  return (Math.atan2(x, z) * 180) / Math.PI;
}

/** Degrees above the horizon. */
function elevationOf(framed: FramedShot): number {
  const [x, y, z] = offset(framed);
  return (Math.atan2(y, Math.hypot(x, z)) * 180) / Math.PI;
}

function distanceOf(framed: FramedShot): number {
  const [x, y, z] = offset(framed);
  return Math.hypot(x, y, z);
}

describe('frameShot', () => {
  it('puts a medium, eye-level, front camera on +z with the lookAt at 70 % of the box height', () => {
    const framed = frameShot(shot({ size: 'medium', angle: 'eye', side: 'front', fov: 35 }), CAN, ASPECT);

    expect(framed.position[0]).toBeCloseTo(0, 6);
    expect(framed.position[2]).toBeGreaterThan(0);
    // 70 % of the box height, measured from the bottom.
    expect(framed.lookAt[1]).toBeCloseTo(CAN.min.y + 0.7 * 1.8, 9);
    expect(framed.lookAt[0]).toBeCloseTo(0, 9);
    expect(framed.lookAt[2]).toBeCloseTo(0, 9);
    // d = (h × visibleFraction) / (2 tan(fov / 2) × size) = (1.8 × 0.6) / (2 tan(17.5°) × 0.8)
    expect(distanceOf(framed)).toBeCloseTo(2.14083, 4);
    expect(framed.fov).toBe(35);
  });

  it('rotates the camera -35 degrees around the lookAt for left3q', () => {
    const front = frameShot(shot({ size: 'medium', side: 'front' }), CAN, ASPECT);
    const left = frameShot(shot({ size: 'medium', side: 'left3q' }), CAN, ASPECT);

    expect(azimuthOf(left) - azimuthOf(front)).toBeCloseTo(-35, 10);
    // The rotation is around the lookAt, so the distance and the lookAt stay put.
    expect(distanceOf(left)).toBeCloseTo(distanceOf(front), 9);
    expect(left.lookAt[1]).toBeCloseTo(front.lookAt[1], 9);
  });

  it('moves the camera position by exactly -35 degrees around the vertical axis for left3q', () => {
    const front = frameShot(shot({ size: 'medium', side: 'front' }), CAN, ASPECT);
    const left = frameShot(shot({ size: 'medium', side: 'left3q' }), CAN, ASPECT);

    // The front offset turned -35 degrees about the lookAt's vertical axis is the left3q offset.
    const rotated = new THREE.Vector3(...offset(front))
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(-35))
      .toArray();
    const leftOffset = offset(left);

    expect(leftOffset[0]).toBeCloseTo(rotated[0], 9);
    expect(leftOffset[1]).toBeCloseTo(rotated[1], 9);
    expect(leftOffset[2]).toBeCloseTo(rotated[2], 9);
  });

  it.each([
    ['front', 0],
    ['right3q', 35],
    ['leftProfile', -90],
    ['rightProfile', 90],
    ['back', 180],
  ] as const)('places the %s camera at %i degrees', (side, degrees) => {
    const framed = frameShot(shot({ size: 'medium', side }), CAN, ASPECT);
    expect(azimuthOf(framed)).toBeCloseTo(degrees, 10);
  });

  it('gets closer as the shot tightens', () => {
    const distance = (size: ShotSpec['size']) => distanceOf(frameShot(shot({ size }), CAN, ASPECT));

    expect(distance('closeUp')).toBeLessThan(distance('medium'));
    expect(distance('medium')).toBeLessThan(distance('wide'));
    expect(distance('wide')).toBeLessThan(distance('extremeWide'));
  });

  it('puts an overhead camera above the lookAt at 80 degrees of elevation', () => {
    const framed = frameShot(shot({ size: 'medium', angle: 'overhead' }), CAN, ASPECT);

    expect(framed.position[1]).toBeGreaterThan(framed.lookAt[1]);
    expect(elevationOf(framed)).toBeCloseTo(80, 10);
  });

  it.each([
    ['eye', 0],
    ['low', -20],
    ['high', 25],
  ] as const)('puts a %s camera at %i degrees of elevation', (angle, degrees) => {
    const framed = frameShot(shot({ size: 'medium', angle }), CAN, ASPECT);
    expect(elevationOf(framed)).toBeCloseTo(degrees, 10);
  });

  it('defaults to eye level, the front side and a 35 degree lens', () => {
    const framed = frameShot(shot({ size: 'wide' }), CAN, ASPECT);

    expect(framed.fov).toBe(35);
    expect(azimuthOf(framed)).toBeCloseTo(0, 10);
    expect(elevationOf(framed)).toBeCloseTo(0, 10);
  });

  it('looks at the top of the subject for a close-up', () => {
    const framed = frameShot(shot({ size: 'closeUp' }), CAN, ASPECT);

    // 85 % of the box height.
    expect(framed.lookAt[1]).toBeCloseTo(CAN.min.y + 0.85 * 1.8, 9);
  });

  it('measures a subject wider than it is tall through its width', () => {
    const wide = new THREE.Box3(new THREE.Vector3(-2, -0.25, -1), new THREE.Vector3(2, 0.25, 1));
    const framed = frameShot(shot({ size: 'medium' }), wide, ASPECT);

    // The width (4 m) scaled by the aspect ratio is the subject height, and the whole subject is
    // framed, so the lookAt is the box centre.
    expect(framed.lookAt[1]).toBeCloseTo(0, 9);
    expect(distanceOf(framed)).toBeCloseTo(4 / ASPECT / (2 * Math.tan((35 * Math.PI) / 360) * 0.8), 6);
  });
});
