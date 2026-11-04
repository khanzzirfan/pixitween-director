import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  SHADOW_FADE_START,
  createShadowCatcher,
  fitShadowCamera,
  patchShadowEdgeFade,
  shadowEdgeFade,
} from './shadow';

describe('createShadowCatcher', () => {
  it('opacity 0.35 / y 0 / size 20 lies flat at y 0 with a ShadowMaterial', () => {
    const mesh = createShadowCatcher({ opacity: 0.35, y: 0, size: 20 });
    expect(mesh.rotation.x).toBeCloseTo(-Math.PI / 2, 6);
    expect(mesh.position.y).toBe(0);
    expect(mesh.receiveShadow).toBe(true);
    expect(mesh.castShadow).toBe(false);

    const material = mesh.material as THREE.ShadowMaterial;
    expect(material.isShadowMaterial).toBe(true);
    expect(material.opacity).toBe(0.35);
    expect(material.transparent).toBe(true);
    expect(typeof material.onBeforeCompile).toBe('function');

    const geometry = mesh.geometry as THREE.PlaneGeometry;
    geometry.computeBoundingBox();
    const size = new THREE.Vector3();
    geometry.boundingBox?.getSize(size);
    expect(size.x).toBeCloseTo(20, 6);
    expect(size.y).toBeCloseTo(20, 6);
    expect(size.z).toBeCloseTo(0, 6);
  });

  it('honours a y offset', () => {
    expect(createShadowCatcher({ opacity: 0.5, y: -0.5, size: 4 }).position.y).toBe(-0.5);
  });
});

describe('fitShadowCamera', () => {
  it('fits the light ortho camera around the box', () => {
    const light = new THREE.DirectionalLight();
    light.position.set(0, 12, 0);
    light.target.position.set(0, 0, 0);
    const box = new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));

    fitShadowCamera(light, box);

    const camera = light.shadow.camera;
    const radius = Math.sqrt(3);
    expect(camera.right).toBeCloseTo(radius, 6);
    expect(camera.left).toBeCloseTo(-radius, 6);
    expect(camera.top).toBeCloseTo(radius, 6);
    expect(camera.bottom).toBeCloseTo(-radius, 6);
    expect(camera.far).toBeGreaterThan(camera.near);
  });

  it('falls back to a default radius for an empty box', () => {
    const light = new THREE.DirectionalLight();
    fitShadowCamera(light, new THREE.Box3());
    expect(light.shadow.camera.right).toBe(6);
  });
});

describe('shadowEdgeFade', () => {
  it('is full in the middle and fades to zero at the edge', () => {
    expect(shadowEdgeFade(0)).toBe(1);
    expect(shadowEdgeFade(SHADOW_FADE_START)).toBe(1);
    expect(shadowEdgeFade(1)).toBe(0);
    expect(shadowEdgeFade(0.65)).toBeGreaterThan(0);
    expect(shadowEdgeFade(0.65)).toBeLessThan(1);
  });
});

describe('patchShadowEdgeFade', () => {
  it('adds the radial fade to the shadow shader', () => {
    const shader = {
      vertexShader: 'void main() {\n#include <begin_vertex>\n}',
      fragmentShader:
        'void main() {\ngl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) );\n}',
    };
    patchShadowEdgeFade(shader);
    expect(shader.vertexShader).toContain('varying vec2 vShadowPos;');
    expect(shader.vertexShader).toContain('vShadowPos = position.xy;');
    expect(shader.fragmentShader).toContain('varying vec2 vShadowPos;');
    expect(shader.fragmentShader).toContain('float shadowFade');
  });
});