import { Sprite, type Application } from 'pixi.js';
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NodeContext } from '../core/types';
import type { MotionDoc } from '../schema';
import { parseMotionDoc } from '../schema/doc';
import { type ThreeLayer } from '../schema/layer3d';
import {
  ThreeOffscreenRenderer,
  debugRendererCount,
  setOffscreenRendererFactoryForTests,
  type OffscreenGlRenderer,
} from './offscreen';
import { createThreeNode, type ThreeNode } from './threeNode';

class FakeGlRenderer implements OffscreenGlRenderer {
  readonly domElement = document.createElement('canvas');
  readonly renderCalls: Array<[THREE.Scene, THREE.Camera]> = [];
  readonly setSizeCalls: Array<[number, number, boolean | undefined]> = [];
  disposed = false;
  private readonly size = new THREE.Vector2(0, 0);

  getSize(target: THREE.Vector2): THREE.Vector2 {
    return target.copy(this.size);
  }

  setSize(width: number, height: number, updateStyle?: boolean): void {
    this.setSizeCalls.push([width, height, updateStyle]);
    this.size.set(width, height);
    this.domElement.width = width;
    this.domElement.height = height;
  }

  setViewport(): void {}

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    this.renderCalls.push([scene, camera]);
  }

  dispose(): void {
    this.disposed = true;
  }

  forceContextLoss(): void {}
}

function makeLayer(overrides: Record<string, unknown> = {}): ThreeLayer {
  const result = parseMotionDoc({
    version: 1,
    width: 1920,
    height: 1080,
    fps: 30,
    duration: 5,
    background: '#000000',
    assets: {},
    layers: [
      {
        id: 'stage',
        type: 'three',
        width: 320,
        height: 240,
        lighting: { preset: 'studio', environment: 'none' },
        objects: [{ id: 'b', geometry: { type: 'box', size: [1, 1, 1] } }],
        ...overrides,
      },
    ],
  });
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  const layer = result.doc.layers[0];
  if (layer.type !== 'three') throw new Error('expected a three layer');
  return layer;
}

function context(): NodeContext {
  return { doc: { layers: [] } as unknown as MotionDoc, textures: new Map(), app: null as Application | null };
}

const originalGetContext = HTMLCanvasElement.prototype.getContext;
let gl: FakeGlRenderer;
const created: ThreeNode[] = [];

function create(layer: ThreeLayer = makeLayer()): ThreeNode {
  const node = createThreeNode(layer, context(), 0) as ThreeNode;
  created.push(node);
  return node;
}

describe('createThreeNode', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    gl = new FakeGlRenderer();
    setOffscreenRendererFactoryForTests(() => new ThreeOffscreenRenderer(gl));
    // jsdom has no 2D context, so the offscreen renderer gets a recording double.
    HTMLCanvasElement.prototype.getContext = (() => ({
      clearRect: vi.fn(),
      drawImage: vi.fn(),
    })) as never;
  });

  afterEach(() => {
    for (const node of created) node.destroy();
    created.length = 0;
    vi.advanceTimersByTime(2000);
    setOffscreenRendererFactoryForTests(null);
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('resolves object targets against the wrapper and refuses bad ones', () => {
    const node = create();

    const ref = node.resolveTarget('object:b', 'rotation.y');
    expect(ref?.kind).toBe('deg');
    expect(ref?.key).toBe('y');
    expect((ref?.obj as THREE.Euler).isEuler).toBe(true);

    expect(node.resolveTarget('object:b', 'rotation.w')).toBeNull();
    expect(node.resolveTarget('object:zz', 'scale')).toBeNull();
  });

  it('resolves camera and light targets and refuses postfx without a chain', () => {
    const node = create();

    const camera = node.resolveTarget('camera', 'position.z');
    expect(camera).not.toBeNull();
    expect(camera?.key).toBe('z');

    const light = node.resolveTarget('light:key', 'intensity');
    expect(light).not.toBeNull();
    expect(light?.key).toBe('intensity');

    expect(node.resolveTarget('postfx:glow', 'intensity')).toBeNull();
  });

  it('draws once on the first update and resolves ready', async () => {
    const node = create();

    node.update?.(1);
    await node.ready;
    expect(gl.renderCalls).toHaveLength(1);

    node.update?.(2);
    expect(gl.renderCalls).toHaveLength(2);
  });

  it('releases the renderer after the grace period and disposes the rig', () => {
    const geometryDispose = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose');
    const materialDispose = vi.spyOn(THREE.Material.prototype, 'dispose');
    const node = create();
    expect(debugRendererCount()).toBe(1);

    node.destroy();
    expect(debugRendererCount()).toBe(1);

    vi.advanceTimersByTime(2000);
    expect(debugRendererCount()).toBe(0);
    expect(geometryDispose).toHaveBeenCalled();
    expect(materialDispose).toHaveBeenCalled();
  });

  it('does not throw when the renderer factory throws, and ready rejects', async () => {
    setOffscreenRendererFactoryForTests(() => {
      throw new Error('no webgl');
    });

    let node!: ThreeNode;
    expect(() => {
      node = createThreeNode(makeLayer(), context(), 0) as ThreeNode;
    }).not.toThrow();

    expect(node.display).toBeInstanceOf(Sprite);
    await expect(node.ready).rejects.toThrow('no webgl');
    expect(debugRendererCount()).toBe(0);

    node.destroy();
  });
});
