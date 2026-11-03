import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildCaustics, causticsFade } from './caustics';
import { buildSmoke, noiseMap, smokePuffs, steamFade } from './smoke';

describe('smoke puffs', () => {
  it('are the same for the same time and seed, so seeking gives the same frame', () => {
    expect(smokePuffs('cloud', 1.2, 2, 5)).toEqual(smokePuffs('cloud', 1.2, 2, 5));
    expect(smokePuffs('powder', 0.7, 2, 5)).toEqual(smokePuffs('powder', 0.7, 2, 5));
    expect(smokePuffs('cloud', 1.2, 2, 5)).not.toEqual(smokePuffs('cloud', 1.2, 2, 6));
  });
  it('a cloud thickens, then clears by its end to show what is inside', () => {
    const alpha = (t: number) => Math.max(...smokePuffs('cloud', t, 2, 1).map((p) => p.alpha));
    expect(alpha(0.6)).toBeGreaterThan(0.4);
    expect(alpha(2)).toBeLessThan(0.05);
  });
  it('powder flies outward from the middle and slows', () => {
    const spread = (t: number) => Math.max(...smokePuffs('powder', t, 2, 1).map((p) => Math.hypot(p.x - 0.5, p.z - 0.5)));
    expect(spread(0.3)).toBeGreaterThan(spread(0.1));
    expect(spread(1.5) - spread(1.2)).toBeLessThan(spread(0.4) - spread(0.1));
  });
});

describe('steam', () => {
  it('rises in at the start and thins out at the end', () => {
    expect(steamFade(0, 3)).toBe(0);
    expect(steamFade(1.5, 3)).toBe(1);
    expect(steamFade(3, 3)).toBe(0);
  });
  it('has a noise picture that tiles and spans the full range', () => {
    const t = noiseMap();
    const data = t.image.data as Uint8Array;
    const n = t.image.width;
    let lo = 255;
    let hi = 0;
    for (let i = 0; i < data.length; i += 4) {
      lo = Math.min(lo, data[i]!);
      hi = Math.max(hi, data[i]!);
    }
    expect([lo, hi]).toEqual([0, 255]);
    expect(t.wrapS).toBe(THREE.RepeatWrapping);
    // the right edge runs on into the left edge: neighbours across the seam are close
    const at = (x: number, y: number) => data[(y * n + x) * 4]!;
    expect(Math.abs(at(n - 1, 10) - at(0, 10))).toBeLessThan(40);
  });
  it('builds twisted ribbons whose time and opacity follow the clock', () => {
    const rig = buildSmoke({ form: 'steam', duration: 3, size: 0.3, color: '#ffffff' });
    const ribbons: THREE.Mesh[] = [];
    rig.mesh.traverse((o) => {
      if (o instanceof THREE.Mesh && o.material instanceof THREE.ShaderMaterial) ribbons.push(o);
    });
    expect(ribbons).toHaveLength(2);
    rig.setTime(1.5);
    const m = ribbons[0]!.material as THREE.ShaderMaterial;
    expect(m.uniforms.uTime!.value).toBe(1.5);
    expect(m.uniforms.opacity!.value).toBeGreaterThan(0);
    rig.setTime(3);
    expect(m.uniforms.opacity!.value).toBe(0);
  });
  it('cloud and powder are one instanced mesh of puffs', () => {
    const rig = buildSmoke({ form: 'cloud', duration: 2, size: 0.4, color: '#cccccc' });
    rig.setTime(0.8);
    expect((rig.mesh.geometry as THREE.InstancedBufferGeometry).instanceCount).toBe(smokePuffs('cloud', 0.8, 2).length);
  });
});

describe('caustics', () => {
  it('fade from full under the product to nothing at the fade distance', () => {
    expect(causticsFade(0, 0.3)).toBe(1);
    expect(causticsFade(0.15, 0.3)).toBeCloseTo(0.5, 5);
    expect(causticsFade(0.4, 0.3)).toBe(0);
  });
  it('add light over the floor and move with the clock', () => {
    const rig = buildCaustics({ size: [4, 4], strength: 0.6, fade: 0.3, scale: 40, color: '#ffffff' });
    const m = rig.mesh.material as THREE.ShaderMaterial;
    expect(m.blending).toBe(THREE.AdditiveBlending);
    expect(m.depthWrite).toBe(false);
    rig.setTime(2.5);
    expect(m.uniforms.uTime!.value).toBe(2.5);
  });
});
