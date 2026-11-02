import * as THREE from 'three';
import { BloomEffect, ToneMappingEffect, ToneMappingMode } from 'postprocessing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildEffectChain, setEffectChainFactoryForTests, type EffectChain, type EffectSpecInput } from './chain';

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

  class SepiaEffect extends Effect {}
  class ColorAverageEffect extends Effect {}
  class PixelationEffect extends Effect {}
  class ScanlineEffect extends Effect {}
  class DotScreenEffect extends Effect {}
  class TiltShiftEffect extends Effect {}
  class Pass {
    renderToScreen = false;
    needsDepthTexture = false;
    fullscreenMaterial: unknown = null;
    dispose(): void {}
    setSize(): void {}
  }
  class KawaseBlurPass {
    scale = 1;
    renderToScreen = false;
    isBlur = true;
  }
  class CopyPass {
    renderToScreen = false;
    constructor(public target: unknown) {}
  }

  class ToneMappingEffect extends Effect {
    constructor(options: { mode?: number } = {}) {
      super();
      state.toneMappingModes.push(options.mode ?? -1);
    }
  }

  class RenderPass {
    renderToScreen = false;
    clearPass = { overrideClearAlpha: -1 };
    constructor(scene: unknown, camera: unknown) {
      state.renderPasses.push({ scene, camera, clearPass: this.clearPass });
    }
  }

  class EffectPass {
    renderToScreen = false;
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

    constructor(renderer: { toneMapping: number; autoClear: boolean }, _options?: { frameBufferType?: number; alpha?: boolean }) {
      this.renderer = renderer;
      renderer.autoClear = false;
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
      (this.renderer as unknown as { setSize(w: number, h: number): void }).setSize(width, height);
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
    SepiaEffect,
    ColorAverageEffect,
    PixelationEffect,
    ScanlineEffect,
    DotScreenEffect,
    TiltShiftEffect,
    KawaseBlurPass,
    Pass,
    CopyPass,
    KernelSize: { MEDIUM: 2 },
  };
});

const SIZE = { width: 320, height: 240 };

interface FakeRenderer {
  toneMapping: number;
  autoClear: boolean;
  target: unknown;
  calls: string[];
  size: [number, number];
  getSize(target: THREE.Vector2): THREE.Vector2;
  setSize(w: number, h: number): void;
  getRenderTarget(): unknown;
  setRenderTarget(t: unknown): void;
  clear(): void;
  render(scene: unknown, camera: unknown): void;
}

function fakeRenderer(): FakeRenderer {
  return {
    toneMapping: THREE.ACESFilmicToneMapping,
    autoClear: true,
    target: null,
    calls: [],
    size: [1920, 1080] as [number, number],
    getSize(target: THREE.Vector2) {
      return target.set(this.size[0], this.size[1]);
    },
    setSize(w: number, h: number) {
      this.size = [w, h];
    },
    getRenderTarget() {
      return this.target;
    },
    setRenderTarget(t) {
      this.target = t;
      this.calls.push(`setRenderTarget:${t === null ? 'null' : 'target'}`);
    },
    clear() {
      this.calls.push('clear');
    },
    render() {
      this.calls.push('render');
    },
  };
}

let renderer: FakeRenderer;
const output = { isWebGLRenderTarget: true } as unknown as THREE.WebGLRenderTarget;

function build(effects: EffectSpecInput[], opts: { output?: THREE.WebGLRenderTarget | null; toneMapping?: boolean } = {}): EffectChain {
  return buildEffectChain({
    renderer: renderer as unknown as THREE.WebGLRenderer,
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(),
    effects,
    size: SIZE,
    output: opts.output === undefined ? output : opts.output,
    toneMapping: opts.toneMapping ?? true,
  });
}

const r = () => renderer as unknown as THREE.WebGLRenderer;

describe('buildEffectChain', () => {
  beforeEach(() => {
    renderer = fakeRenderer();
    state.composers.length = 0;
    state.effectPasses.length = 0;
    state.renderPasses.length = 0;
    state.toneMappingModes.length = 0;
  });

  it('makes one EffectPass with the enabled effects and ACES tone mapping last', () => {
    build([{ id: 'glow', type: 'bloom' }, { id: 'vig', type: 'vignette', enabled: false }]);

    expect(state.effectPasses).toHaveLength(1);
    const [bloom, toneMapping] = state.effectPasses[0].effects;
    expect(state.effectPasses[0].effects).toHaveLength(2);
    expect(bloom).toBeInstanceOf(BloomEffect);
    expect(toneMapping).toBeInstanceOf(ToneMappingEffect);
    expect(state.toneMappingModes).toEqual([ToneMappingMode.ACES_FILMIC]);
  });

  it('ends with a CopyPass into the output target, and has none when output is null', () => {
    build([{ id: 'glow', type: 'bloom' }]);
    const passes = state.composers[0].passes as Array<{ constructor: { name: string }; target?: unknown }>;
    const last = passes[passes.length - 1];
    expect(last.constructor.name).toBe('CopyPass');
    expect(last.target).toBe(output);

    build([{ id: 'glow', type: 'bloom' }], { output: null });
    const second = state.composers[1].passes as Array<{ constructor: { name: string }; renderToScreen: boolean }>;
    expect(second.some((pass) => pass.constructor.name === 'CopyPass')).toBe(false);
    expect(second[second.length - 1].renderToScreen).toBe(true);
  });

  it('takes the fast path with no effects and no tone mapping', () => {
    const chain = build([], { toneMapping: false });
    chain.render(r());
    expect(state.composers).toHaveLength(0);
    expect(renderer.calls).toEqual(['setRenderTarget:target', 'clear', 'render', 'setRenderTarget:null']);
  });

  it('puts blur in front of the EffectPass as a pass', () => {
    build([{ id: 'soft', type: 'blur' }, { id: 'v', type: 'vignette' }], { toneMapping: false });
    const names = (state.composers[0].passes as Array<{ constructor: { name: string } }>).map((pass) => pass.constructor.name);
    expect(names).toEqual(['RenderPass', 'KawaseBlurPass', 'EffectPass', 'CopyPass']);
  });

  it('sizes the composer to the layer but leaves the canvas size alone', () => {
    build([{ id: 'glow', type: 'bloom' }]);
    expect(state.composers[0].sizeCalls).toEqual([[320, 240]]);
    expect(renderer.size).toEqual([1920, 1080]);
  });

  it('keeps the renderer autoClear the composer turned off', () => {
    build([{ id: 'glow', type: 'bloom' }]);
    expect(renderer.autoClear).toBe(true);
  });

  it('clears the render pass to transparent', () => {
    build([{ id: 'glow', type: 'bloom' }]);
    expect(state.renderPasses[0].clearPass.overrideClearAlpha).toBe(0);
  });

  it('sets NoToneMapping during render and restores ACES afterwards', () => {
    const chain = build([{ id: 'glow', type: 'bloom' }]);
    chain.render(r());
    expect(state.composers[0].deltas).toEqual([0]);
    expect(state.composers[0].renderToneMappings).toEqual([THREE.NoToneMapping]);
    expect(renderer.toneMapping).toBe(THREE.ACESFilmicToneMapping);
  });

  it('restores the renderer tone mapping when composer.render throws', () => {
    const chain = build([{ id: 'glow', type: 'bloom' }]);
    state.composers[0].throwOnRender = true;
    expect(() => chain.render(r())).toThrow('composer render failed');
    expect(renderer.toneMapping).toBe(THREE.ACESFilmicToneMapping);
    expect(renderer.autoClear).toBe(true);
  });

  it('disposes the composer once', () => {
    build([{ id: 'glow', type: 'bloom' }]).dispose();
    expect(state.composers[0].disposals).toBe(1);
  });

  it('routes effect:<id> targets through the effect setter and reports hue as degrees', () => {
    const chain = build([{ id: 'glow', type: 'bloom' }, { id: 'hue', type: 'hueSaturation' }]);
    const ref = chain.resolveTarget('glow', 'intensity');
    if (!ref) throw new Error('expected a bloom intensity target');
    expect(ref.kind).toBe('number');
    (ref.obj as Record<string, number>)[ref.key] = 2;
    expect((state.effectPasses[0].effects[0] as { intensity: number }).intensity).toBe(2);
    expect(chain.resolveTarget('hue', 'hue')?.kind).toBe('deg');
    expect(chain.resolveTarget('glow', 'nope')).toBeNull();
    expect(chain.resolveTarget('nope', 'intensity')).toBeNull();
  });

  it('records unknown params without throwing', () => {
    const chain = build([{ id: 'glow', type: 'bloom', params: { nope: 3 } }]);
    expect(chain.errors).toEqual(['effect "glow": unknown param "nope"']);
  });

  it('uses the test factory when one is set', () => {
    const fake = { render: vi.fn(), setSize: vi.fn(), resolveTarget: () => null, dispose: vi.fn(), errors: [] };
    setEffectChainFactoryForTests(() => fake);
    try {
      expect(buildEffectChain({ renderer: null, scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), effects: [], size: SIZE, output: null, toneMapping: true })).toBe(fake);
    } finally {
      setEffectChainFactoryForTests(null);
    }
  });
});
