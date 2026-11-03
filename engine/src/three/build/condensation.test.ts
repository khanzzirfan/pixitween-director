import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { beadHeights, wet } from './condensation';
import { makeMaterial } from './materials';

describe('condensation', () => {
  it('is a field of beads: the same every time, domes with a peak, and gaps between them', () => {
    const a = beadHeights(128, 90, 3);
    expect(beadHeights(128, 90, 3)).toEqual(a);
    expect(Math.max(...a)).toBeGreaterThan(150);
    const wetShare = a.filter((v) => v > 0).length / a.length;
    expect(wetShare).toBeGreaterThan(0.05);
    expect(wetShare).toBeLessThan(0.8);
  });

  it('wets a material with a bump map that grows with the amount, and leaves a dry one alone', () => {
    const light = new THREE.MeshPhysicalMaterial({ roughness: 0.4, clearcoat: 0 });
    wet(light, 0.4);
    const heavy = new THREE.MeshPhysicalMaterial({ roughness: 0.4, clearcoat: 0 });
    wet(heavy, 0.9);
    expect(light.bumpMap).toBeTruthy();
    expect(heavy.bumpScale).toBeGreaterThan(light.bumpScale);
    expect(heavy.roughness).toBeLessThan(0.4);
    expect(heavy.clearcoat).toBeGreaterThanOrEqual(0.6);
    const dry = new THREE.MeshStandardMaterial();
    wet(dry, 0);
    expect(dry.bumpMap).toBeNull();
  });

  it('is part of a material spec: makeMaterial wets it when the spec says so', () => {
    const spec = { color: '#ffffff', roughness: 0.3, metalness: 0.6, emissive: '#000000', emissiveIntensity: 0, opacity: 1, clearcoat: 0.8, condensation: 0.9 };
    expect(makeMaterial(spec).bumpMap).toBeTruthy();
    expect(makeMaterial({ ...spec, condensation: undefined }).bumpMap).toBeNull();
  });
});
