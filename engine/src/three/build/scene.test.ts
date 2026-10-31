import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { parseMotionDoc } from '../../schema/doc';
import { type ThreeLayer } from '../../schema/layer3d';
import { type LoadedGltf } from './gltf';
import { buildObject } from './object';
import { buildScene } from './scene';

interface ThreeLayerInput {
  width?: number;
  height?: number;
  background?: string;
  assets?: Record<string, unknown>;
  camera?: Record<string, unknown>;
  lighting?: Record<string, unknown>;
  shadow?: Record<string, unknown>;
  lights?: unknown[];
  objects?: unknown[];
}

function makeLayer(input: ThreeLayerInput = {}): ThreeLayer {
  const { width = 800, height = 400, assets = {}, ...rest } = input;
  const result = parseMotionDoc({
    version: 1,
    width: 1920,
    height: 1080,
    fps: 30,
    duration: 5,
    background: '#000000',
    assets,
    layers: [{ id: 'stage', type: 'three', width, height, ...rest }],
  });
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  const layer = result.doc.layers[0];
  if (layer.type !== 'three') throw new Error('expected a three layer');
  return layer;
}

const BOX = { id: 'box', geometry: { type: 'box', size: [1, 1, 1] } };

describe('buildScene objects', () => {
  it('converts a rotation of [0, 90, 0] to radians', () => {
    const layer = makeLayer({ objects: [{ ...BOX, rotation: [0, 90, 0] }] });
    const rig = buildScene(layer);
    expect(rig.objects.get('box')?.rotation.y).toBeCloseTo(Math.PI / 2, 10);
  });

  it('puts position and scale on the wrapper and collects objects by id', () => {
    const layer = makeLayer({
      objects: [{ ...BOX, position: [2, 1, -3], scale: 2 }, { id: 'ball', geometry: { type: 'sphere', radius: 0.5 } }],
    });
    const rig = buildScene(layer);
    expect([...rig.objects.keys()]).toEqual(['box', 'ball']);
    const root = rig.objects.get('box');
    expect(root?.position.toArray()).toEqual([2, 1, -3]);
    expect(root?.scale.toArray()).toEqual([2, 2, 2]);
  });
});

describe('buildScene camera', () => {
  it('reads fov and aspect from the layer', () => {
    const layer = makeLayer({ width: 800, height: 400, camera: { fov: 42 }, objects: [BOX] });
    const rig = buildScene(layer);
    expect(rig.camera.fov).toBe(42);
    expect(rig.camera.aspect).toBe(2);
  });

  it('starts the camera at the layer position with the layer lookAt', () => {
    const layer = makeLayer({ camera: { position: [1, 2, 3], lookAt: [0, 1, 0] }, objects: [BOX] });
    const rig = buildScene(layer);
    expect(rig.camera.position.toArray()).toEqual([1, 2, 3]);
    expect(rig.lookAt.toArray()).toEqual([0, 1, 0]);
  });
});

describe('buildScene lights', () => {
  it('registers key, fill, rim and ambient plus every extra light', () => {
    const layer = makeLayer({
      lighting: { preset: 'studio' },
      lights: [
        { id: 'rimlight', type: 'directional', intensity: 1.6 },
        { id: 'glow', type: 'point', intensity: 0.4 },
      ],
      objects: [BOX],
    });
    const rig = buildScene(layer);
    expect([...rig.lights.keys()].sort()).toEqual(['ambient', 'fill', 'glow', 'key', 'rim', 'rimlight']);
    expect(rig.lights.get('key')).toBeInstanceOf(THREE.DirectionalLight);
    expect(rig.lights.get('fill')).toBeInstanceOf(THREE.DirectionalLight);
    expect(rig.lights.get('rim')).toBeInstanceOf(THREE.DirectionalLight);
    expect(rig.lights.get('ambient')).toBeInstanceOf(THREE.AmbientLight);
    expect(rig.lights.get('glow')).toBeInstanceOf(THREE.PointLight);
  });

  it('preset none keeps only the extra lights', () => {
    const layer = makeLayer({
      lighting: { preset: 'none' },
      lights: [{ id: 'spot1', type: 'spot' }],
      objects: [BOX],
    });
    const rig = buildScene(layer);
    expect([...rig.lights.keys()]).toEqual(['spot1']);
  });
});

describe('buildScene background', () => {
  it('paints an opaque background and leaves transparent alone', () => {
    expect(buildScene(makeLayer({ background: '#123456', objects: [BOX] })).scene.background).toBeInstanceOf(THREE.Color);
    expect(buildScene(makeLayer({ background: 'transparent', objects: [BOX] })).scene.background).toBeNull();
  });
});

describe('buildScene dispose', () => {
  it('disposes every geometry and material in the scene', () => {
    const layer = makeLayer({
      objects: [BOX, { id: 'ball', geometry: { type: 'sphere', radius: 0.5 } }],
    });
    const rig = buildScene(layer);

    const meshes: THREE.Mesh[] = [];
    rig.scene.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh) meshes.push(mesh);
    });
    expect(meshes.length).toBeGreaterThanOrEqual(3);

    const spies = meshes.flatMap((mesh) => {
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      return [vi.spyOn(mesh.geometry, 'dispose'), ...materials.map((material) => vi.spyOn(material, 'dispose'))];
    });

    rig.dispose();

    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('buildObject gltf', () => {
  it('clones a loaded gltf, normalises it to the height and animates the picked clip', () => {
    const layer = makeLayer({
      assets: { robot: { type: 'gltf', url: '/robot.glb' } },
      objects: [{ id: 'robot', geometry: { type: 'gltf', asset: 'robot', height: 4 }, animation: { clip: 'Wave' } }],
    });
    const spec = layer.objects[0];

    const source = new THREE.Group();
    source.add(new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshStandardMaterial()));
    const loaded = {
      scene: source,
      animations: [new THREE.AnimationClip('Wave', 2, [])],
    } as unknown as LoadedGltf;

    const built = buildObject(spec, { gltfs: new Map([['robot', loaded]]) });

    expect(built.root.children).toHaveLength(1);
    const content = built.root.children[0];
    expect(content).not.toBe(source);
    const box = new THREE.Box3().setFromObject(content);
    expect(box.max.y - box.min.y).toBeCloseTo(4, 6);
    expect(box.min.y).toBeCloseTo(0, 6);
    expect(built.clip?.name).toBe('Wave');
    expect(built.mixer).toBeInstanceOf(THREE.AnimationMixer);
  });

  it('warns and stays empty when the gltf asset is not loaded', () => {
    const layer = makeLayer({
      assets: { robot: { type: 'gltf', url: '/robot.glb' } },
      objects: [{ id: 'robot', geometry: { type: 'gltf', asset: 'robot' } }],
    });
    const built = buildObject(layer.objects[0], { gltfs: new Map() });
    expect(built.warnings.join(' ')).toContain('robot');
    expect(built.root.children).toHaveLength(0);
    expect(built.mixer).toBeUndefined();
  });
});
