import { describe, expect, it } from 'vitest';
import { Light3DSchema, Object3DSchema, ThreeLayerSchema } from './layer3d';
import { LayerSchema } from './layer';

const threeInput = {
  id: 'h',
  type: 'three',
  width: 512,
  height: 512,
  objects: [{ id: 'b', geometry: { type: 'box', size: [1, 1, 1] } }],
};

describe('ThreeLayerSchema', () => {
  it('fills the camera, lighting, shadow, background and object defaults', () => {
    const layer = ThreeLayerSchema.parse(threeInput);
    expect(layer.camera.position).toEqual([0, 1.2, 6]);
    expect(layer.camera.lookAt).toEqual([0, 0.6, 0]);
    expect(layer.camera.fov).toBe(35);
    expect(layer.camera.near).toBe(0.1);
    expect(layer.camera.far).toBe(200);
    expect(layer.lighting.preset).toBe('studio');
    expect(layer.lighting.environment).toBe('room');
    expect(layer.shadow.enabled).toBe(true);
    expect(layer.shadow.opacity).toBe(0.35);
    expect(layer.shadow.y).toBe(0);
    expect(layer.background).toBe('transparent');
    expect(layer.lights).toEqual([]);
    expect(layer.postFx).toEqual([]);
    expect(layer.start).toBe(0);
    expect(layer.filters).toEqual([]);
    expect(layer.tweens).toEqual([]);
    const object = layer.objects[0];
    expect(object.material.color).toBe('#cccccc');
    expect(object.material.roughness).toBe(0.4);
    expect(object.material.metalness).toBe(0);
    expect(object.material.emissive).toBe('#000000');
    expect(object.material.emissiveIntensity).toBe(0);
    expect(object.material.opacity).toBe(1);
    expect(object.castShadow).toBe(true);
    expect(object.position).toEqual([0, 0, 0]);
    expect(object.rotation).toEqual([0, 0, 0]);
    expect(object.scale).toBe(1);
  });

  it('rejects 0 objects, a width of 4096 and a too-small height', () => {
    expect(ThreeLayerSchema.safeParse({ ...threeInput, objects: [] }).success).toBe(false);
    expect(ThreeLayerSchema.safeParse({ ...threeInput, width: 4096 }).success).toBe(false);
    expect(ThreeLayerSchema.safeParse({ ...threeInput, height: 8 }).success).toBe(false);
  });

  it('rejects an unknown key', () => {
    expect(ThreeLayerSchema.safeParse({ ...threeInput, foo: 1 }).success).toBe(false);
  });

  it('accepts an opaque background and environment none on the none preset', () => {
    const layer = ThreeLayerSchema.parse({ ...threeInput, background: '#101418', lighting: { preset: 'none' } });
    expect(layer.background).toBe('#101418');
    expect(layer.lighting.environment).toBe('none');
  });
});

describe('Light3DSchema', () => {
  it('fills the light defaults', () => {
    const light = Light3DSchema.parse({ id: 'spot', type: 'spot' });
    expect(light.color).toBe('#ffffff');
    expect(light.intensity).toBe(1);
    expect(light.position).toEqual([3, 5, 4]);
    expect(light.target).toEqual([0, 0, 0]);
    expect(light.castShadow).toBe(false);
  });

  it('rejects the reserved preset rig ids but accepts an extra light', () => {
    for (const id of ['key', 'fill', 'rim', 'ambient']) {
      expect(ThreeLayerSchema.safeParse({ ...threeInput, lights: [{ id, type: 'point' }] }).success).toBe(false);
    }
    expect(ThreeLayerSchema.safeParse({ ...threeInput, lights: [{ id: 'extra', type: 'point' }] }).success).toBe(true);
  });

  it('rejects more than 6 lights', () => {
    const lights = Array.from({ length: 7 }, (_, i) => ({ id: `l${i}`, type: 'point' as const }));
    expect(ThreeLayerSchema.safeParse({ ...threeInput, lights }).success).toBe(false);
  });
});

describe('Object3DSchema', () => {
  it('rejects animation on a non-gltf geometry', () => {
    expect(Object3DSchema.safeParse({ id: 'b', geometry: { type: 'box', size: [1, 1, 1] }, animation: { speed: 1 } }).success).toBe(false);
  });

  it('parses animation on a gltf geometry with its defaults', () => {
    const object = Object3DSchema.parse({ id: 'b', geometry: { type: 'gltf', asset: 'robot' }, animation: {} });
    expect(object.geometry.type).toBe('gltf');
    expect(object.animation?.speed).toBe(1);
    expect(object.animation?.loop).toBe(true);
    expect(object.animation?.offset).toBe(0);
    expect(object.animation?.clip).toBeUndefined();
  });

  it('parses every primitive geometry', () => {
    expect(Object3DSchema.safeParse({ id: 'a', geometry: { type: 'sphere', radius: 1 } }).success).toBe(true);
    expect(Object3DSchema.safeParse({ id: 'a', geometry: { type: 'cylinder', radiusTop: 1, radiusBottom: 1, height: 2 } }).success).toBe(true);
    expect(Object3DSchema.safeParse({ id: 'a', geometry: { type: 'torus', radius: 1, tube: 0.2 } }).success).toBe(true);
    expect(Object3DSchema.safeParse({ id: 'a', geometry: { type: 'plane', size: [2, 1] } }).success).toBe(true);
  });

  it('rejects a bad geometry and an unknown key', () => {
    expect(Object3DSchema.safeParse({ id: 'a', geometry: { type: 'sphere', radius: -1 } }).success).toBe(false);
    expect(Object3DSchema.safeParse({ id: 'a', geometry: { type: 'pyramid' } }).success).toBe(false);
    expect(Object3DSchema.safeParse({ id: 'a', geometry: { type: 'box', size: [1, 1, 1] }, foo: 1 }).success).toBe(false);
  });
});

describe('LayerSchema', () => {
  it('discriminates and parses the three layer through the union', () => {
    const layer = LayerSchema.parse(threeInput);
    expect(layer.type).toBe('three');
    if (layer.type !== 'three') throw new Error('expected a three layer');
    expect(layer.camera.fov).toBe(35);
  });
});
