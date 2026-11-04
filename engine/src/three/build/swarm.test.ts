import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { Swarm3D } from '../../schema/layer3d';
import { buildSwarm, createSwarmConstants, swarmPose } from './swarm';

const burst: Swarm3D = {
  count: 12,
  seed: 41,
  motion: 'burst',
  emitter: { shape: 'point', center: [0, 0.08, 0] },
  direction: [0, 1, 0.3],
  spread: 70,
  speed: 0.9,
  drag: 2.2,
  gravity: 2,
  spin: 240,
  stagger: 0.1,
  sizeJitter: 0.2,
  fps: 30,
};

function poses(cfg: Swarm3D, seconds: number): number[][] {
  const constants = createSwarmConstants(cfg);
  const matrix = new THREE.Matrix4();
  return Array.from({ length: constants.count }, (_, i) => {
    swarmPose(constants, i, seconds, matrix);
    return matrix.toArray();
  });
}

describe('swarm', () => {
  it('is a pure function of time and seed: seeking back draws the same copies', () => {
    const first = poses(burst, 0.6);
    poses(burst, 1.4);
    expect(poses(burst, 0.6)).toEqual(first);
  });

  it('a different seed gives different copies', () => {
    expect(poses({ ...burst, seed: 42 }, 0.6)).not.toEqual(poses(burst, 0.6));
  });

  it('copies are hidden (zero scale) until their staggered start', () => {
    const constants = createSwarmConstants({ ...burst, stagger: 1 });
    const matrix = new THREE.Matrix4();
    swarmPose(constants, constants.count - 1, 0.01, matrix);
    expect(new THREE.Vector3().setFromMatrixScale(matrix).length()).toBe(0);
    swarmPose(constants, constants.count - 1, 2, matrix);
    expect(new THREE.Vector3().setFromMatrixScale(matrix).length()).toBeGreaterThan(0.5);
  });

  it('burst copies leave the emitter; gravity pulls fall copies down', () => {
    const matrix = new THREE.Matrix4();
    const out = createSwarmConstants(burst);
    swarmPose(out, 0, 0.8, matrix);
    expect(new THREE.Vector3().setFromMatrixPosition(matrix).distanceTo(new THREE.Vector3(0, 0.08, 0))).toBeGreaterThan(0.05);
    const fall = createSwarmConstants({ ...burst, motion: 'fall', direction: [0, -1, 0], emitter: { shape: 'box', center: [0, 0.45, 0.1], size: [0.5, 0.05, 0.4] }, stagger: 0, speed: 0.1, gravity: 3, drag: 0 });
    swarmPose(fall, 0, 0.5, matrix);
    const early = new THREE.Vector3().setFromMatrixPosition(matrix).y;
    swarmPose(fall, 0, 1, matrix);
    expect(new THREE.Vector3().setFromMatrixPosition(matrix).y).toBeLessThan(early);
  });

  it('orbit copies stay at their radius around the emitter centre', () => {
    const cfg: Swarm3D = { ...burst, motion: 'orbit', orbit: { radius: 0.13, angularSpeed: 40, height: 0.12, bob: 0.01 }, stagger: 0, count: 6 };
    const constants = createSwarmConstants(cfg);
    const matrix = new THREE.Matrix4();
    for (let i = 0; i < constants.count; i++) {
      swarmPose(constants, i, 1.2, matrix);
      const p = new THREE.Vector3().setFromMatrixPosition(matrix);
      const r = Math.hypot(p.x, p.z);
      expect(r).toBeGreaterThan(0.13 * 0.8 - 1e-6);
      expect(r).toBeLessThan(0.13 * 1.2 + 1e-6);
    }
  });

  it('grow-in scales a copy from nothing over growFrames', () => {
    const constants = createSwarmConstants({ ...burst, stagger: 0, growFrames: 6, sizeJitter: 0 });
    const matrix = new THREE.Matrix4();
    swarmPose(constants, 0, 1 / 30, matrix);
    const early = new THREE.Vector3().setFromMatrixScale(matrix).x;
    swarmPose(constants, 0, 0.5, matrix);
    expect(early).toBeLessThan(new THREE.Vector3().setFromMatrixScale(matrix).x);
    expect(new THREE.Vector3().setFromMatrixScale(matrix).x).toBeCloseTo(1, 5);
  });
  it('keeps every material of the source, so an extruded cut-out keeps its photo caps and its coloured sides', () => {
    const caps = new THREE.MeshStandardMaterial({ color: '#ffffff' });
    const sides = new THREE.MeshStandardMaterial({ color: '#85604d' });
    const shape = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(1, 0), new THREE.Vector2(1, 1)]);
    const rig = buildSwarm(new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.3 }), [caps, sides]), burst);
    expect(rig.mesh.material).toEqual([caps, sides]);
    expect(rig.mesh.geometry.groups.length).toBe(2);
  });
});
