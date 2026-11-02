// Ported from reacthub-pixitweenjs src/components/AepComposition/Aep3DPostFx.tsx (MIT).
import {
  CopyPass,
  EffectComposer,
  EffectPass,
  RenderPass,
  ToneMappingEffect,
  ToneMappingMode,
  type Effect,
  type Pass,
} from 'postprocessing';
import * as THREE from 'three';
import type { TargetRef } from '../core/paths';
import type { EffectType } from '../schema';
import { EFFECTS, PASS_EFFECTS, type EffectDef, type ParamValue } from './table';

// One effect chain (engine/docs/05-effects.md, "The chain"): a three layer, an isolated 2D layer and
// the whole stage all render through this. RenderPass → optional blur pass → one EffectPass (ACES
// tone mapping last for three layers) → CopyPass into `output` when it is a render target.

/** One effect spec, before the table merges in its defaults. */
export interface EffectSpecInput {
  id: string;
  type: EffectType;
  enabled?: boolean;
  params?: Record<string, ParamValue>;
}

export interface EffectChain {
  /** Renders `scene` with `camera` through the effects into `output`, or to the canvas when output is null. */
  render(renderer: THREE.WebGLRenderer): void;
  setSize(width: number, height: number): void;
  /** An `effect:<id>` target for `prop`, or null when the id or the param is unknown. */
  resolveTarget(id: string, prop: string): TargetRef | null;
  dispose(): void;
  readonly errors: string[];
}

export interface EffectChainOptions {
  renderer: THREE.WebGLRenderer | null;
  scene: THREE.Scene;
  camera: THREE.Camera;
  effects: EffectSpecInput[];
  size: { width: number; height: number };
  output: THREE.WebGLRenderTarget | null;
  /** true for three layers (ACES last), false for 2D layers and the stage. */
  toneMapping: boolean;
}

export type EffectChainFactory = (opts: EffectChainOptions) => EffectChain;

let factoryForTests: EffectChainFactory | null = null;

/** Unit tests (no WebGL) swap the chain for a fake; pass null to restore the real one. */
export function setEffectChainFactoryForTests(fn: EffectChainFactory | null): void {
  factoryForTests = fn;
}

/** The fake currently installed, so a headless caller can swap it in and put it back. */
export function getEffectChainFactoryForTests(): EffectChainFactory | null {
  return factoryForTests;
}

/** A proxy with an accessor per tweenable param; the setter calls the effect table's `set`. */
function makeProxy(effect: Effect | Pass, def: EffectDef): Record<string, ParamValue> {
  const proxy: Record<string, ParamValue> = {};
  for (const [prop, spec] of Object.entries(def.tweenable)) {
    Object.defineProperty(proxy, prop, {
      get: () => spec.get(effect),
      set: (value: ParamValue) => spec.set(effect, value),
      enumerable: true,
      configurable: true,
    });
  }
  return proxy;
}

function colorRef(proxy: Record<string, ParamValue>, prop: string): TargetRef {
  return {
    obj: proxy,
    key: prop,
    kind: 'color',
    getColor: () => String(proxy[prop]),
    setColor: (hex) => {
      proxy[prop] = hex;
    },
  };
}

/** Renders with the renderer's own tone mapping off, restoring it afterwards (also on throw). */
function withoutToneMapping(renderer: THREE.WebGLRenderer, draw: () => void): void {
  const previous = renderer.toneMapping;
  renderer.toneMapping = THREE.NoToneMapping;
  try {
    draw();
  } finally {
    renderer.toneMapping = previous;
  }
}

export function buildEffectChain(opts: EffectChainOptions): EffectChain {
  if (factoryForTests) return factoryForTests(opts);
  const { renderer, scene, camera, size, output, toneMapping } = opts;
  if (!renderer) throw new Error('motion: buildEffectChain needs a renderer (or a test factory)');

  const errors: string[] = [];
  const byId = new Map<string, { def: EffectDef; proxy: Record<string, ParamValue> }>();
  const effects: Effect[] = [];
  const passes: Pass[] = [];

  for (const spec of opts.effects) {
    if (spec.enabled === false) continue;
    const def = EFFECTS[spec.type];
    if (!def) {
      errors.push(`effect "${spec.id}": type "${spec.type}" is not available`);
      continue;
    }
    const params = spec.params ?? {};
    for (const key of Object.keys(params)) {
      if (!(key in def.defaults)) errors.push(`effect "${spec.id}": unknown param "${key}"`);
    }
    try {
      const built = def.create({ ...def.defaults, ...params }, { camera, size });
      if (PASS_EFFECTS.has(spec.type)) passes.push(built as Pass);
      else effects.push(built as Effect);
      byId.set(spec.id, { def, proxy: makeProxy(built, def) });
    } catch (error) {
      errors.push(`effect "${spec.id}": ${String(error)}`);
    }
  }

  const resolveTarget = (id: string, prop: string): TargetRef | null => {
    const entry = byId.get(id);
    const spec = entry?.def.tweenable[prop];
    if (!entry || !spec) return null;
    if (spec.kind === 'color') return colorRef(entry.proxy, prop);
    return { obj: entry.proxy, key: prop, kind: spec.kind };
  };

  // Fast path: nothing to post-process and no tone mapping, so a plain render is the same picture.
  if (effects.length === 0 && passes.length === 0 && !toneMapping) {
    return {
      errors,
      render(r) {
        const previous = r.getRenderTarget();
        r.setRenderTarget(output);
        try {
          if (output) r.clear();
          r.render(scene, camera);
        } finally {
          r.setRenderTarget(previous);
        }
      },
      setSize() {},
      resolveTarget,
      dispose() {},
    };
  }

  // EffectComposer turns the shared renderer's autoClear off; the stage relies on it, so it is put
  // back here and only switched off while this composer renders.
  const autoClear = renderer.autoClear;
  const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, alpha: true });
  renderer.autoClear = autoClear;
  const renderPass = new RenderPass(scene, camera);
  // Clear to transparent so a transparent layer stays transparent where nothing is drawn.
  renderPass.clearPass.overrideClearAlpha = 0;
  composer.addPass(renderPass);
  for (const pass of passes) composer.addPass(pass);

  const finalEffects: Effect[] = [...effects];
  if (toneMapping) finalEffects.push(new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC }));
  if (finalEffects.length > 0) composer.addPass(new EffectPass(camera, ...finalEffects));

  if (output) {
    // The composer marks its last pass renderToScreen on addPass; a target chain must never draw to
    // the canvas, so that is turned off before adding the copy.
    composer.autoRenderToScreen = false;
    for (const pass of composer.passes) pass.renderToScreen = false;
    const copy = new CopyPass(output, false);
    composer.addPass(copy);
    copy.renderToScreen = false;
  } else {
    // The last pass draws to the canvas.
    const last = composer.passes[composer.passes.length - 1];
    if (last) last.renderToScreen = true;
  }
  // EffectComposer.setSize also resizes the renderer's canvas; the canvas belongs to the stage, so
  // its size is put back and only the composer's buffers keep the layer size.
  const sizeComposer = (width: number, height: number): void => {
    const canvasSize = renderer.getSize(new THREE.Vector2());
    composer.setSize(width, height, false);
    renderer.setSize(canvasSize.x, canvasSize.y, false);
  };
  sizeComposer(size.width, size.height);

  return {
    errors,
    render(r) {
      const previous = r.getRenderTarget();
      const previousAutoClear = r.autoClear;
      r.autoClear = false;
      try {
        // A fixed delta keeps time-driven effects deterministic across seeks.
        withoutToneMapping(r, () => composer.render(0));
      } finally {
        r.autoClear = previousAutoClear;
        r.setRenderTarget(previous);
      }
    },
    setSize(width, height) {
      sizeComposer(width, height);
    },
    resolveTarget,
    dispose() {
      composer.dispose();
    },
  };
}
