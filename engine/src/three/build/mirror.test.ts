import type * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Geometry3DSchema } from '../../schema/layer3d';
import { buildMirror, mirrorFade } from './mirror';
import { buildObject } from './object';

describe('mirror floor', () => {
  it('fades from full under the product to nothing at its fade distance', () => {
    expect(mirrorFade(0, 0.4)).toBe(1);
    expect(mirrorFade(0.2, 0.4)).toBeCloseTo(0.25, 2);
    expect(mirrorFade(0.4, 0.4)).toBe(0);
    expect(mirrorFade(2, 0.4)).toBe(0);
  });

  it('is a transparent reflector with its strength and fade as uniforms, sized to the frame', () => {
    const m = buildMirror({ size: [8, 8], strength: 0.4, fade: 0.35, blur: 1, viewport: { width: 1080, height: 1920 } });
    const mat = m.material as THREE.ShaderMaterial;
    expect(mat.transparent).toBe(true);
    expect(mat.depthWrite).toBe(false);
    expect(mat.uniforms.uStrength!.value).toBe(0.4);
    expect(mat.uniforms.uFade!.value).toBe(0.35);
    const rt = m.getRenderTarget();
    expect(rt.width / rt.height).toBeCloseTo(1080 / 1920, 1);
    expect(Math.max(rt.width, rt.height)).toBeLessThanOrEqual(640);
    m.dispose();
  });

  it('is a geometry the engine builds in an object, laid flat by the object\'s own rotation', () => {
    const geometry = Geometry3DSchema.parse({ type: 'mirror', size: [4, 4], strength: 0.5, fade: 0.4 });
    const built = buildObject({ id: 'mirror', geometry, position: [0, 0.0008, 0], rotation: [-90, 0, 0], scale: 1, material: { color: '#ffffff', roughness: 1, metalness: 0, emissive: '#000000', emissiveIntensity: 0, opacity: 1 }, castShadow: false } as never, { viewport: { width: 540, height: 960 } });
    expect((built.root.children[0] as THREE.Object3D & { isReflector?: boolean }).isReflector).toBe(true);
    expect(built.root.rotation.x).toBeCloseTo(-Math.PI / 2);
    built.dispose();
  });
});
