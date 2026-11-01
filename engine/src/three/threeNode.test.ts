import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TargetRef } from '../core/paths';
import type { NodeContext } from '../core/types';
import { setEffectChainFactoryForTests, type EffectChain, type EffectChainOptions } from '../effects/chain';
import type { MotionDoc } from '../schema';
import { parseMotionDoc } from '../schema/doc';
import { type ThreeLayer } from '../schema/layer3d';
import { frameShot } from './camera/frameShot';
import { createThreeNode, type ThreeNode } from './threeNode';

function makeLayer(overrides: Record<string, unknown> = {}, assets: Record<string, unknown> = {}): ThreeLayer {
  const result = parseMotionDoc({
    version: 1,
    width: 1920,
    height: 1080,
    duration: 5,
    assets,
    layers: [
      {
        id: 'stage',
        type: 'three',
        width: 320,
        height: 240,
        x: 100,
        y: 50,
        anchor: [0, 0],
        lighting: { preset: 'studio', environment: 'none' },
        objects: [{ id: 'b', geometry: { type: 'box', size: [1, 1, 1] } }],
        effects: [{ id: 'glow', type: 'bloom' }],
        ...overrides,
      },
    ],
  });
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  const layer = result.doc.layers[0];
  if (layer.type !== 'three') throw new Error('expected a three layer');
  return layer;
}

const context = (): NodeContext => ({ doc: { layers: [] } as unknown as MotionDoc, textures: new Map(), renderer: null });

type FakeChain = EffectChain & {
  render: ReturnType<typeof vi.fn<(renderer: THREE.WebGLRenderer) => void>>;
  dispose: ReturnType<typeof vi.fn<() => void>>;
  options: EffectChainOptions;
};

let chains: FakeChain[] = [];
const created: ThreeNode[] = [];
const effectProxy = { intensity: 1 };

function create(layer: ThreeLayer = makeLayer()): ThreeNode {
  const node = createThreeNode(layer, context(), 0) as ThreeNode;
  created.push(node);
  return node;
}

describe('createThreeNode', () => {
  beforeEach(() => {
    chains = [];
    setEffectChainFactoryForTests((options) => {
      const chain: FakeChain = {
        options,
        errors: [],
        render: vi.fn<(renderer: THREE.WebGLRenderer) => void>(),
        setSize: vi.fn(),
        dispose: vi.fn<() => void>(),
        resolveTarget: (id, prop): TargetRef | null => (id === 'glow' && prop === 'intensity' ? { obj: effectProxy, key: 'intensity', kind: 'number' } : null),
      };
      chains.push(chain);
      return chain;
    });
  });

  afterEach(() => {
    for (const node of created) node.destroy();
    created.length = 0;
    setEffectChainFactoryForTests(null);
    vi.restoreAllMocks();
  });

  it('builds a chain into its own render target with tone mapping', () => {
    create();
    expect(chains).toHaveLength(1);
    expect(chains[0].options.output).toBeInstanceOf(THREE.WebGLRenderTarget);
    expect(chains[0].options.toneMapping).toBe(true);
    expect(chains[0].options.size).toEqual({ width: 320, height: 240 });
  });

  it('shows the target on a plane inside the layer transform', () => {
    const node = create();
    expect(node.display.position.toArray()).toEqual([100, -50, 0]);
    const plane = node.content.children[0] as THREE.Mesh;
    expect(plane.isMesh).toBe(true);
    expect(plane.position.toArray()).toEqual([160, -120, 0]);
    expect((plane.material as THREE.MeshBasicMaterial).map).toBe(chains[0].options.output?.texture);
  });

  it('resolves object, camera, light and effect targets and refuses bad ones', () => {
    const node = create();
    expect(node.resolveTarget('object:b', 'rotation.y')?.kind).toBe('deg');
    expect(node.resolveTarget('object:zz', 'scale')).toBeNull();
    expect(node.resolveTarget('camera', 'position.z')?.key).toBe('z');
    expect(node.resolveTarget('light:key', 'intensity')?.key).toBe('intensity');
    const effectRef = node.resolveTarget('effect:glow', 'intensity');
    expect(effectRef?.key).toBe('intensity');
    expect((effectRef?.obj as Record<string, number>).intensity).toBe(1);
    (effectRef?.obj as Record<string, number>).intensity = 2;
    expect(effectProxy.intensity).toBe(2);
    expect(node.resolveTarget('effect:nope', 'intensity')).toBeNull();
    expect(node.resolveTarget(undefined, 'y')?.kind).toBe('number');
  });

  it('renders the chain once per update and is ready', async () => {
    const node = create();
    await node.ready;
    node.update?.(1, 30);
    expect(chains[0].render).toHaveBeenCalledTimes(1);
    node.update?.(2, 60);
    expect(chains[0].render).toHaveBeenCalledTimes(2);
  });

  it('records a render error once and keeps going', () => {
    const node = create();
    chains[0].render.mockImplementation(() => {
      throw new Error('lost context');
    });
    node.update?.(1, 30);
    node.update?.(2, 60);
    expect(node.errors).toEqual(['Error: lost context']);
  });

  it('resolves effect targets before the chain is built (async glTF assets), writing through once it is', async () => {
    const layer = makeLayer(
      { objects: [{ id: 'b', geometry: { type: 'gltf', asset: 'thing' } }] },
      { thing: { type: 'gltf', url: '/thing.glb' } },
    );
    const node = create(layer);

    // The chain doesn't exist yet (its glTF asset load is still pending), but a tween compiled right
    // now against this target must not be dropped — see threeNode.ts's `resolveEffectTarget` comment.
    const ref = node.resolveTarget('effect:glow', 'intensity');
    expect(ref).not.toBeNull();
    expect(chains).toHaveLength(0);
    expect(() => {
      (ref!.obj as Record<string, number>).intensity = 9;
    }).not.toThrow();

    await node.ready.catch(() => {});

    expect(chains).toHaveLength(1);
    (ref!.obj as Record<string, number>).intensity = 3;
    expect(effectProxy.intensity).toBe(3);
  });

  it('applyOpacity sets the plane opacity', () => {
    const node = create();
    node.applyOpacity(0.5);
    const plane = node.content.children[0] as THREE.Mesh;
    expect((plane.material as THREE.MeshBasicMaterial).opacity).toBe(0.5);
  });

  it('destroy disposes the target, plane, chain and rig', () => {
    const targetDispose = vi.spyOn(THREE.WebGLRenderTarget.prototype, 'dispose');
    const geometryDispose = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose');
    const materialDispose = vi.spyOn(THREE.Material.prototype, 'dispose');
    const node = create();
    node.destroy();
    expect(targetDispose).toHaveBeenCalled();
    expect(geometryDispose).toHaveBeenCalled();
    expect(materialDispose).toHaveBeenCalled();
    expect(chains[0].dispose).toHaveBeenCalledTimes(1);
    expect(node.rig).toBeNull();
  });

  it('builds the camera from a shot of the subject’s box', () => {
    const shot = { subject: 'object:can', size: 'closeUp' } as const;
    const layer = makeLayer({
      objects: [{ id: 'can', geometry: { type: 'box', size: [0.6, 1.8, 0.6] } }],
      camera: { shot },
    });
    const node = create(layer);
    const rig = node.rig!;

    const box = new THREE.Box3().setFromObject(rig.objects.get('can')!);
    const framed = frameShot(shot, box, 320 / 240);

    expect(rig.camera.position.toArray()).toEqual(framed.position);
    expect(rig.lookAt.toArray()).toEqual(framed.lookAt);
    expect(rig.camera.fov).toBe(framed.fov);
  });

  it('warns when a shot has nothing to frame', async () => {
    // The glTF never loads, so the subject has no box to frame.
    const layer = makeLayer(
      {
        objects: [{ id: 'can', geometry: { type: 'gltf', asset: 'thing' } }],
        camera: { shot: { subject: 'object:can', size: 'wide' } },
      },
      { thing: { type: 'gltf', url: '/thing.glb' } },
    );
    const node = create(layer);
    await node.ready.catch(() => {});
    expect(node.warnings.join(' ')).toContain('nothing to frame');
  });

  it('samples a camera path on every update and is stateless across seeks', () => {
    const layer = makeLayer({
      camera: {
        path: {
          keys: [
            { t: 0, position: [0, 1, 6], lookAt: [0, 0.6, 0] },
            { t: 2, position: [2, 3, 4], lookAt: [1, 1, 0] },
          ],
          curve: 'linear',
        },
      },
    });
    const node = create(layer);
    const rig = node.rig!;

    node.update?.(1, 30);
    const first = rig.camera.position.toArray();
    expect(first).toEqual([1, 2, 5]);

    // Seeking away and back gives the same camera: the path is sampled, never integrated.
    node.update?.(0, 0);
    expect(rig.camera.position.toArray()).toEqual([0, 1, 6]);
    node.update?.(1, 30);
    expect(rig.camera.position.toArray()).toEqual(first);
  });

  it('resolves the camera rig targets and refuses an unknown one', () => {
    const node = create();
    expect(node.resolveTarget('camera', 'rig.pan')?.key).toBe('pan');
    expect(node.resolveTarget('camera', 'rig.dolly')?.key).toBe('dolly');
    expect(node.resolveTarget('camera', 'rig.zoom')).toBeNull();
  });

  it('applies the rig moves over the rest pose on every update', () => {
    const layer = makeLayer({ camera: { position: [0, 1, 6], lookAt: [0, 1, 0] } });
    const node = create(layer);
    const rig = node.rig!;

    // The rest pose looks down -z, so a dolly of 1 m moves the camera 1 m towards the subject.
    const dolly = node.resolveTarget('camera', 'rig.dolly')!;
    (dolly.obj as Record<string, number>).dolly = 1;
    node.update?.(0, 0);
    expect(rig.camera.position.toArray()).toEqual([0, 1, 5]);
  });

  it('pans the camera about its up axis and restores the rest pose at pan 0', () => {
    const layer = makeLayer({ camera: { position: [0, 1, 6], lookAt: [0, 1, 0] } });
    const node = create(layer);
    const rig = node.rig!;
    const restRotation = rig.camera.quaternion.clone();
    const before = rig.camera.getWorldDirection(new THREE.Vector3());

    const pan = node.resolveTarget('camera', 'rig.pan')!;
    (pan.obj as Record<string, number>).pan = 90;
    node.update?.(0, 0);

    const after = rig.camera.getWorldDirection(new THREE.Vector3());
    expect(after.angleTo(before) * (180 / Math.PI)).toBeCloseTo(90, 6);
    // The turn is around the camera's up axis, so the view stays level.
    expect(after.y).toBeCloseTo(0, 9);

    (pan.obj as Record<string, number>).pan = 0;
    node.update?.(0, 0);
    expect(rig.camera.position.toArray()).toEqual([0, 1, 6]);
    expect(rig.camera.quaternion.angleTo(restRotation)).toBeLessThan(1e-12);
  });

  it('moves the rest pose with a camera tween and rides the rig moves on top of it', () => {
    const layer = makeLayer({ camera: { position: [0, 1, 6], lookAt: [0, 1, 0] } });
    const node = create(layer);
    const rig = node.rig!;

    const position = node.resolveTarget('camera', 'position.z')!;
    (position.obj as Record<string, number>).z = 4;
    const dolly = node.resolveTarget('camera', 'rig.dolly')!;
    (dolly.obj as Record<string, number>).dolly = 1;
    node.update?.(0, 0);

    expect(rig.camera.position.toArray()).toEqual([0, 1, 3]);
  });
});
