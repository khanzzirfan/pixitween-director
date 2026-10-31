import type { Application } from 'pixi.js';
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NodeContext } from '../../core/types';
import type { MotionDoc } from '../../schema';
import { parseMotionDoc } from '../../schema/doc';
import { type ThreeLayer } from '../../schema/layer3d';
import {
  ThreeOffscreenRenderer,
  setOffscreenRendererFactoryForTests,
  type OffscreenGlRenderer,
} from '../offscreen';
import { createThreeNode, type ThreeNode } from '../threeNode';

interface ComposerRecord {
  disposals: number;
  deltas: number[];
}

const state = vi.hoisted(() => ({ composers: [] as ComposerRecord[] }));

// jsdom has no WebGL, so postprocessing is replaced with recording doubles. Importing them is what
// lets the effect table and the chain build; the composer records draw deltas and disposals.
vi.mock('postprocessing', () => {
  class Effect {}

  class BloomEffect extends Effect {
    intensity = 0;
    luminanceMaterial = { threshold: 0, smoothing: 0 };
  }
  class VignetteEffect extends Effect {
    offset = 0;
    darkness = 0;
  }
  class ChromaticAberrationEffect extends Effect {}
  class NoiseEffect extends Effect {}
  class DepthOfFieldEffect extends Effect {}
  class BrightnessContrastEffect extends Effect {}
  class HueSaturationEffect extends Effect {
    hue = 0;
    saturation = 0;
  }
  class ToneMappingEffect extends Effect {}

  class RenderPass {
    clearPass = { overrideClearAlpha: -1 };
  }

  class EffectPass {
    constructor(_camera: unknown, ..._effects: unknown[]) {}
  }

  class EffectComposer {
    disposals = 0;
    deltas: number[] = [];
    constructor() {
      state.composers.push(this);
    }
    addPass(): void {}
    render(deltaTime?: number): void {
      this.deltas.push(deltaTime ?? -1);
    }
    setSize(): void {}
    dispose(): void {
      this.disposals += 1;
    }
  }

  return {
    Effect,
    EffectComposer,
    EffectPass,
    RenderPass,
    ToneMappingEffect,
    ToneMappingMode: { ACES_FILMIC: 7 },
    BlendFunction: { NORMAL: 0, OVERLAY: 10 },
    BloomEffect,
    VignetteEffect,
    ChromaticAberrationEffect,
    NoiseEffect,
    DepthOfFieldEffect,
    BrightnessContrastEffect,
    HueSaturationEffect,
  };
});

class FakeGlRenderer implements OffscreenGlRenderer {
  readonly domElement = document.createElement('canvas');
  readonly renderCalls: Array<[THREE.Scene, THREE.Camera]> = [];
  private readonly size = new THREE.Vector2(0, 0);

  getSize(target: THREE.Vector2): THREE.Vector2 {
    return target.copy(this.size);
  }

  setSize(width: number, height: number): void {
    this.size.set(width, height);
    this.domElement.width = width;
    this.domElement.height = height;
  }

  setViewport(): void {}

  render(): void {}

  dispose(): void {}

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
const created: ThreeNode[] = [];

function create(layer: ThreeLayer): ThreeNode {
  const node = createThreeNode(layer, context(), 0) as ThreeNode;
  created.push(node);
  return node;
}

describe('createThreeNode post-processing', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    state.composers.length = 0;
    setOffscreenRendererFactoryForTests(() => new ThreeOffscreenRenderer(new FakeGlRenderer()));
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

  it('routes postfx:<id> targets only for ids the chain knows', () => {
    const node = create(makeLayer({ postFx: [{ id: 'glow', type: 'bloom' }] }));

    const ref = node.resolveTarget('postfx:glow', 'intensity');
    expect(ref).not.toBeNull();
    expect(ref?.kind).toBe('number');
    expect(node.resolveTarget('postfx:none', 'intensity')).toBeNull();
  });

  it('passes a draw function to the render request when postFx is set, and none without it', () => {
    const renderSpy = vi.spyOn(ThreeOffscreenRenderer.prototype, 'render');

    const withPostFx = create(makeLayer({ postFx: [{ id: 'glow', type: 'bloom' }] }));
    withPostFx.update?.(1);
    const withRequest = renderSpy.mock.calls[renderSpy.mock.calls.length - 1][0];
    expect(typeof withRequest.draw).toBe('function');
    expect(state.composers[0].deltas).toEqual([0]);
    expect(renderSpy.mock.instances.length).toBeGreaterThan(0);

    const withoutPostFx = create(makeLayer());
    withoutPostFx.update?.(1);
    const withoutRequest = renderSpy.mock.calls[renderSpy.mock.calls.length - 1][0];
    expect(withoutRequest.draw).toBeUndefined();
  });

  it('disposes the chain on destroy', () => {
    const node = create(makeLayer({ postFx: [{ id: 'glow', type: 'bloom' }] }));
    expect(state.composers).toHaveLength(1);

    node.destroy();

    expect(state.composers[0].disposals).toBe(1);
  });
});
