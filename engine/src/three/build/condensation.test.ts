import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BEAD_FADE, beadHeights, beadLevels, wet } from './condensation';
import { makeMaterial } from './materials';

describe('condensation', () => {
  it('is a field of beads: the same every time, domes with a peak, and gaps between them', () => {
    const a = beadHeights(128, 400, 3);
    expect(beadHeights(128, 400, 3)).toEqual(a);
    expect(Math.max(...a)).toBeGreaterThan(150);
    const wetShare = a.filter((v) => v > 0).length / a.length;
    expect(wetShare).toBeGreaterThan(0.05);
    expect(wetShare).toBeLessThan(0.8);
  });

  it('is a few drops by default, the label clear between them', () => {
    const h = beadHeights();
    const wetShare = h.filter((v) => v > 0).length / h.length;
    expect(wetShare).toBeGreaterThan(0);
    expect(wetShare).toBeLessThan(0.05);
  });

  it('flattens its beads in each smaller copy, so a far can turns smoothly glossy instead of blotchy', () => {
    const size = 64;
    const levels = beadLevels(beadHeights(size, 60, 5), size);
    expect(levels.map((l) => l.width)).toEqual([64, 32, 16, 8, 4, 2, 1]);
    const peak = (n: number): number => Math.max(...levels[n]!.data.filter((_, i) => i % 4 === 0));
    expect(peak(0)).toBeGreaterThan(150);
    for (let n = 1; n < levels.length; n++) expect(peak(n)).toBeLessThanOrEqual(Math.ceil(255 * BEAD_FADE ** n));
    // a dry spot keeps the can's own finish (roughness 1x); the last, flattest copy is nearly all dry finish
    expect(Math.min(...levels.at(-1)!.data.filter((_, i) => i % 4 === 1))).toBeGreaterThan(240);
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
