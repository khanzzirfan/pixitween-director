import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Geometry3DSchema } from '../../schema/layer3d';
import { buildObject } from './object';
import { LIQUID_FLOOR, LIQUID_FORMS, buildLiquid, liquidBalls } from './liquid';

const inBox = (b: { x: number; y: number; z: number }) => [b.x, b.y, b.z].every((v) => v > 0 && v < 1);

describe('liquid', () => {
  it.each(LIQUID_FORMS)('%s is the same shape every time it is asked for the same moment, and stays in its box', (form) => {
    for (const t of [0, 0.3, 0.7, 1.1, 1.5]) {
      const a = liquidBalls(form, t, 1.5, 7);
      if (t >= 0.3 && t < 1.4) expect(a.length).toBeGreaterThan(3);
      expect(liquidBalls(form, t, 1.5, 7)).toEqual(a);
      expect(a.every(inBox)).toBe(true);
    }
  });

  it('crown: the ring rises and widens, its rim breaks into drops that fly out past the wall', () => {
    const top = (t: number) => Math.max(...liquidBalls('crown', t, 1.6, 3).map((b) => b.y));
    const reach = (t: number) => Math.max(...liquidBalls('crown', t, 1.6, 3).map((b) => Math.hypot(b.x - 0.5, b.z - 0.5)));
    expect(top(0.35)).toBeGreaterThan(LIQUID_FLOOR + 0.15);
    expect(reach(0.9)).toBeGreaterThan(reach(0.2));
  });

  it('pour: a stream from above that has reached the floor and spread into a pool by the end', () => {
    const early = liquidBalls('pour', 0.15, 1.5, 2);
    const late = liquidBalls('pour', 1.0, 1.5, 2);
    expect(Math.max(...early.map((b) => b.y))).toBeGreaterThan(0.8);
    const pool = late.filter((b) => b.y <= LIQUID_FLOOR + 0.001);
    expect(pool.length).toBeGreaterThan(5);
  });

  it('blobs: floating drops that move round the middle', () => {
    const a = liquidBalls('blobs', 0.6, 2, 5);
    const b = liquidBalls('blobs', 1.2, 2, 5);
    expect(a[0]).not.toEqual(b[0]);
    expect(Math.abs(a[0]!.y - 0.5)).toBeLessThan(0.3);
  });

  it('builds one smooth mesh that changes shape over time and stands on its origin', () => {
    const rig = buildLiquid({ form: 'crown', duration: 1.5, size: 0.4, resolution: 28 }, new THREE.MeshStandardMaterial());
    rig.setTime(0.4);
    const early = rig.mesh.count;
    expect(early).toBeGreaterThan(0);
    rig.setTime(1.0);
    expect(rig.mesh.count).not.toBe(early);
    expect(rig.mesh.position.y).toBeCloseTo(0.2);
    expect(rig.mesh.scale.x).toBeCloseTo(0.2);
  });

  it('is an object geometry the engine builds and ticks, never fitted', () => {
    const geometry = Geometry3DSchema.parse({ type: 'liquid', form: 'pour', size: 0.3, duration: 1.2, resolution: 28 });
    const built = buildObject({
      id: 'coffee',
      geometry,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: 1,
      material: { color: '#3b2314', roughness: 0.08, metalness: 0, emissive: '#000000', emissiveIntensity: 0, opacity: 1, clearcoat: 1 },
      castShadow: true,
    } as never);
    expect(built.tick).toBeTypeOf('function');
    built.tick!(0.5, new THREE.PerspectiveCamera());
    const mesh = built.root.children[0] as THREE.Mesh;
    expect((mesh.material as THREE.MeshPhysicalMaterial).clearcoat).toBe(1);
    built.dispose();
  });
});
