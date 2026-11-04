import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Object3DSchema } from '../../schema/layer3d';
import { buildObject } from './object';
import { viewWeights } from './views';

const bottle: Array<[number, number]> = [[15, 0], [25, 0], [25, 30], [40, 40], [40, 100], [0, 100], [0, 40], [15, 30]];
const spec = (material: Record<string, unknown>, section: number | null = 2) =>
  Object3DSchema.parse({ id: 'body', geometry: { type: 'extrude', contour: bottle, depth: 40, ...(section !== null ? { section } : {}) }, material });
const tex = (id: string) => [id, new THREE.Texture()] as const;
const textures = new Map([tex('front'), tex('back'), tex('profile')]);
const meshOf = (o: ReturnType<typeof buildObject>) => o.root.children[0] as THREE.Mesh;

describe('buildObject: a body with drawn views', () => {
  it('is one material over the photo that blends in the back and the side by view, with the views coordinates', () => {
    const mesh = meshOf(buildObject(spec({ map: 'front', backMap: 'back', profileMap: 'profile' }), { textures }));
    const m = mesh.material as THREE.MeshStandardMaterial;
    expect(Array.isArray(mesh.material)).toBe(false);
    expect(m.map).toBe(textures.get('front'));
    expect(m.alphaTest).toBe(0.5);
    expect(m.customProgramCacheKey()).toBe('views:11');
    expect(mesh.geometry.getAttribute('views')).toBeDefined();
    // the shader takes both pictures
    const shader = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: '#include <common>\n#include <uv_vertex>', fragmentShader: '#include <common>\n#include <map_fragment>' };
    m.onBeforeCompile(shader as never, undefined as never);
    expect(shader.uniforms.viewBackMap!.value).toBe(textures.get('back'));
    expect(shader.uniforms.viewSideMap!.value).toBe(textures.get('profile'));
    expect(shader.fragmentShader).toContain('viewWeights');
  });
  it('follows the camera: from the front the weights are all the photo', () => {
    const mesh = meshOf(buildObject(spec({ map: 'front', backMap: 'back', profileMap: 'profile' }), { textures }));
    const m = mesh.material as THREE.MeshStandardMaterial;
    const shader = { uniforms: {} as Record<string, { value: THREE.Vector3 }>, vertexShader: '#include <common>\n#include <uv_vertex>', fragmentShader: '#include <common>\n#include <map_fragment>' };
    m.onBeforeCompile(shader as never, undefined as never);
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 0, 10);
    camera.updateMatrixWorld();
    mesh.onBeforeRender(undefined as never, undefined as never, camera, mesh.geometry, m, null as never);
    expect(shader.uniforms.viewWeights!.value.toArray()).toEqual([1, 0, 0]);
    camera.position.set(10, 0, 0);
    camera.updateMatrixWorld();
    mesh.onBeforeRender(undefined as never, undefined as never, camera, mesh.geometry, m, null as never);
    expect(shader.uniforms.viewWeights!.value.z).toBeCloseTo(1, 5);
  });
  it('is the plain photo without drawn views, and for an extrude without a section', () => {
    const plain = meshOf(buildObject(spec({ map: 'front' }), { textures }));
    expect(plain.geometry.getAttribute('views')).toBeUndefined();
    expect((plain.material as THREE.Material).customProgramCacheKey()).not.toContain('views');
    expect(meshOf(buildObject(spec({ map: 'front', backMap: 'back' }, null), { textures })).geometry.getAttribute('views')).toBeUndefined();
  });
});

describe('viewWeights', () => {
  const at = (deg: number) => new THREE.Vector3(Math.sin((deg * Math.PI) / 180), 0, Math.cos((deg * Math.PI) / 180));
  it('is the photo square on, the side at 90 degrees, the back at 180, and a blend between that adds up to 1', () => {
    const all = { back: true, side: true };
    expect(viewWeights(at(0), all)).toEqual({ front: 1, back: 0, side: 0 });
    expect(viewWeights(at(90), all).side).toBeCloseTo(1, 5);
    expect(viewWeights(at(180), all).back).toBeCloseTo(1, 5);
    const w = viewWeights(at(30), all);
    expect(w.front).toBeGreaterThan(0.95);
    // one picture holds to within about 5 degrees of the halfway turn
    expect(viewWeights(at(39), all).front).toBeGreaterThan(0.85);
    expect(w.front + w.back + w.side).toBeCloseTo(1, 5);
    expect(viewWeights(at(45), all).front).toBeCloseTo(0.5, 5);
  });
  it('gives a missing back to the front, a missing side nothing, and the photo straight above', () => {
    expect(viewWeights(at(180), { back: false, side: true }).front).toBeCloseTo(1, 5);
    expect(viewWeights(at(90), { back: true, side: false })).toEqual({ front: 1, back: 0, side: 0 });
    expect(viewWeights(new THREE.Vector3(0, 1, 0), { back: true, side: true })).toEqual({ front: 1, back: 0, side: 0 });
  });
});
