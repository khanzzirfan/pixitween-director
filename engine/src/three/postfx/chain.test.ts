import * as THREE from 'three';
import { BloomEffect, ToneMappingEffect, ToneMappingMode } from 'postprocessing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildPostFxChain, type PostFx, type PostFxChain } from './chain';

interface ComposerRecord {
  renderer: { toneMapping: number };
  passes: unknown[];
  renderToneMappings: number[];
  deltas: number[];
  sizeCalls: Array<[number, number]>;
  disposals: number;
  throwOnRender: boolean;
}

interface EffectPassRecord {
  effects: unknown[];
}

interface RenderPassRecord {
  scene: unknown;
  camera: unknown;
  clearPass: { overrideClearAlpha: number };
}

const state = vi.hoisted(() => ({
  composers: [] as ComposerRecord[],
  effectPasses: [] as EffectPassRecord[],
  renderPasses: [] as RenderPassRecord[],
  toneMappingModes: [] as number[],
}));

// jsdom has no WebGL, so the whole postprocessing module is replaced with recording doubles that
// capture the composer, the passes and their effects.
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

  class ToneMappingEffect extends Effect {
    constructor(options: { mode?: number } = {}) {
      super();
      state.toneMappingModes.push(options.mode ?? -1);
    }
  }

  class RenderPass {
    clearPass = { overrideClearAlpha: -1 };
    constructor(scene: unknown, camera: unknown) {
      state.renderPasses.push({ scene, camera, clearPass: this.clearPass });
    }
  }

  class EffectPass {
    effects: unknown[];
    constructor(_camera: unknown, ...effects: unknown[]) {
      this.effects = effects;
      state.effectPasses.push({ effects });
    }
  }

  class EffectComposer {
    renderer: { toneMapping: number };
    passes: unknown[] = [];
    renderToneMappings: number[] = [];
    deltas: number[] = [];
    sizeCalls: Array<[number, number]> = [];
    disposals = 0;
    throwOnRender = false;

    constructor(renderer: { toneMapping: number }, _options?: { frameBufferType?: number; alpha?: boolean }) {
      this.renderer = renderer;
      state.composers.push(this);
    }

    addPass(pass: unknown): void {
      this.passes.push(pass);
    }

    render(deltaTime?: number): void {
      this.deltas.push(deltaTime ?? -1);
      this.renderToneMappings.push(this.renderer.toneMapping);
      if (this.throwOnRender) throw new Error('composer render failed');
    }

    setSize(width: number, height: number): void {
      this.sizeCalls.push([width, height]);
    }

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

const SIZE = { width: 320, height: 240 };

// The chain is built over the shared renderer and `draw` is handed that same instance (offscreen.ts
// passes `this.renderer`), so the fake is one shared renderer rather than a new object per call.
const sharedRenderer = { toneMapping: THREE.ACESFilmicToneMapping };

function fakeRenderer(): { toneMapping: number } {
  return sharedRenderer;
}

function build(specs: PostFx[]): PostFxChain {
  const chain = buildPostFxChain(
    fakeRenderer() as unknown as THREE.WebGLRenderer,
    new THREE.Scene(),
    new THREE.PerspectiveCamera(),
    specs,
    SIZE,
  );
  if (!chain) throw new Error('expected a post-processing chain');
  return chain;
}

describe('buildPostFxChain', () => {
  beforeEach(() => {
    state.composers.length = 0;
    state.effectPasses.length = 0;
    state.renderPasses.length = 0;
    state.toneMappingModes.length = 0;
  });

  it('makes one EffectPass with the enabled effects and ACES tone mapping last', () => {
    build([{ id: 'glow', type: 'bloom' }, { id: 'vig', type: 'vignette', enabled: false }]);

    expect(state.effectPasses).toHaveLength(1);
    expect(state.effectPasses[0].effects).toHaveLength(2);
    const [bloom, toneMapping] = state.effectPasses[0].effects;
    expect(bloom).toBeInstanceOf(BloomEffect);
    expect(toneMapping).toBeInstanceOf(ToneMappingEffect);
    expect(state.toneMappingModes).toEqual([ToneMappingMode.ACES_FILMIC]);
    expect(state.composers).toHaveLength(1);
    expect(state.composers[0].sizeCalls).toEqual([[320, 240]]);
  });

  it('clears the render pass to transparent', () => {
    build([{ id: 'glow', type: 'bloom' }]);

    expect(state.renderPasses).toHaveLength(1);
    expect(state.renderPasses[0].clearPass.overrideClearAlpha).toBe(0);
  });

  it('sets NoToneMapping during draw and restores ACES afterwards', () => {
    const chain = build([{ id: 'glow', type: 'bloom' }]);
    const renderer = fakeRenderer();

    chain.draw(renderer as unknown as THREE.WebGLRenderer);

    expect(state.composers[0].deltas).toEqual([0]);
    expect(state.composers[0].renderToneMappings).toEqual([THREE.NoToneMapping]);
    expect(renderer.toneMapping).toBe(THREE.ACESFilmicToneMapping);
  });

  it('restores the renderer tone mapping when composer.render throws', () => {
    const chain = build([{ id: 'glow', type: 'bloom' }]);
    const renderer = fakeRenderer();
    state.composers[0].throwOnRender = true;

    expect(() => chain.draw(renderer as unknown as THREE.WebGLRenderer)).toThrow('composer render failed');
    expect(state.composers[0].renderToneMappings).toEqual([THREE.NoToneMapping]);
    expect(renderer.toneMapping).toBe(THREE.ACESFilmicToneMapping);
  });

  it('returns null when every spec is disabled', () => {
    const chain = buildPostFxChain(
      fakeRenderer() as unknown as THREE.WebGLRenderer,
      new THREE.Scene(),
      new THREE.PerspectiveCamera(),
      [{ id: 'vig', type: 'vignette', enabled: false }],
      SIZE,
    );

    expect(chain).toBeNull();
    expect(state.composers).toHaveLength(0);
  });

  it('disposes the composer once', () => {
    build([{ id: 'glow', type: 'bloom' }]).dispose();

    expect(state.composers[0].disposals).toBe(1);
  });

  it('routes postfx:<id> targets through the effect setter and reports hue as degrees', () => {
    const chain = build([{ id: 'glow', type: 'bloom' }, { id: 'hue', type: 'hueSaturation' }]);

    const ref = chain.resolveTarget('glow', 'intensity');
    expect(ref?.kind).toBe('number');
    if (!ref) throw new Error('expected a bloom intensity target');
    (ref.obj as Record<string, number>)[ref.key] = 2;
    expect((state.effectPasses[0].effects[0] as { intensity: number }).intensity).toBe(2);

    expect(chain.resolveTarget('hue', 'hue')?.kind).toBe('deg');
    expect(chain.resolveTarget('glow', 'nope')).toBeNull();
    expect(chain.resolveTarget('nope', 'intensity')).toBeNull();
  });

  it('records unknown params without throwing', () => {
    const chain = build([{ id: 'glow', type: 'bloom', params: { nope: 3 } }]);

    expect(chain.errors).toEqual(['postFx "glow": unknown param "nope"']);
  });
});
