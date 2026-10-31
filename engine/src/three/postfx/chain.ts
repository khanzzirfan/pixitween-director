// Ported from reacthub-pixitweenjs src/components/AepComposition/Aep3DPostFx.tsx (MIT).
import {
  EffectComposer,
  EffectPass,
  RenderPass,
  ToneMappingEffect,
  ToneMappingMode,
  type Effect,
} from 'postprocessing';
import * as THREE from 'three';
import type { TargetRef } from '../../core/paths';
import type { PostFxType } from '../../schema';
import { POSTFX_DEFS, type PostFxDef } from './effects';

// One layer's post-processing chain (engine/docs/05-filters-postfx.md, "3D post-processing chain"):
// a composer over the shared renderer with a RenderPass and a single EffectPass ending in ACES tone
// mapping. The renderer is shared with layers that do not post-process, so `draw` turns the
// renderer's own tone mapping off for the duration and always restores it afterwards.

/** One `postFx` spec, before the effect table merges in its defaults. */
export interface PostFx {
  id: string;
  type: PostFxType;
  enabled?: boolean;
  params?: Record<string, number>;
}

export interface PostFxChain {
  draw(renderer: THREE.WebGLRenderer): void;
  setSize(width: number, height: number): void;
  /** A `postfx:<id>` target for `prop`, or null when the id or the param is unknown. */
  resolveTarget(id: string, prop: string): TargetRef | null;
  dispose(): void;
  /** Unknown params (and other spec problems), ignored rather than thrown. */
  errors: string[];
}

interface BuiltEffect {
  def: PostFxDef;
  /** One accessor per tweenable param, so a tween writes through `def.tweenable[k].set`. */
  proxy: Record<string, number>;
}

/** A proxy with an accessor per tweenable param; the setter calls the effect table's `set`. */
function makeProxy(effect: Effect, def: PostFxDef): Record<string, number> {
  const proxy: Record<string, number> = {};
  for (const [prop, spec] of Object.entries(def.tweenable)) {
    Object.defineProperty(proxy, prop, {
      get: () => spec.get(effect),
      set: (value: number) => spec.set(effect, value),
      enumerable: true,
      configurable: true,
    });
  }
  return proxy;
}

/**
 * Turns a layer's postFx specs into a live composer plus `postfx:<id>` tween targets over the shared
 * renderer (engine/docs/05-filters-postfx.md). Disabled specs are skipped and an unknown param is
 * reported in `errors`; null when no spec is enabled, so the layer takes the plain-render fast path.
 */
export function buildPostFxChain(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  specs: PostFx[],
  size: { width: number; height: number },
): PostFxChain | null {
  const errors: string[] = [];
  const byId = new Map<string, BuiltEffect>();
  const effects: Effect[] = [];

  for (const spec of specs) {
    if (spec.enabled === false) continue;

    const def: PostFxDef = POSTFX_DEFS[spec.type];
    const params = spec.params ?? {};

    for (const key of Object.keys(params)) {
      if (!(key in def.defaults)) {
        errors.push(`postFx "${spec.id}": unknown param "${key}"`);
      }
    }

    try {
      const effect = def.create({ ...def.defaults, ...params }, camera);
      effects.push(effect);
      byId.set(spec.id, { def, proxy: makeProxy(effect, def) });
    } catch (error) {
      errors.push(`postFx "${spec.id}": ${String(error)}`);
    }
  }

  // No enabled spec (or every one failed): the layer renders plainly, so there is nothing to build.
  if (effects.length === 0) return null;

  const renderPass = new RenderPass(scene, camera);
  // The composer renders into its own buffers; force the cleared alpha to 0 so a transparent layer
  // stays transparent where nothing is drawn.
  renderPass.clearPass.overrideClearAlpha = 0;

  // ACES tone mapping last: the composer applies it, so the renderer's own mapping is off in `draw`.
  const toneMapping = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
  const effectPass = new EffectPass(camera, ...effects, toneMapping);

  const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, alpha: true });
  composer.addPass(renderPass);
  composer.addPass(effectPass);
  composer.setSize(size.width, size.height);

  return {
    errors,

    draw(drawRenderer) {
      const previous = drawRenderer.toneMapping;
      drawRenderer.toneMapping = THREE.NoToneMapping;
      try {
        // A fixed delta keeps the time-driven effects deterministic across seeks.
        composer.render(0);
      } finally {
        drawRenderer.toneMapping = previous;
      }
    },

    setSize(width, height) {
      composer.setSize(width, height);
    },

    resolveTarget(id, prop) {
      const entry = byId.get(id);
      if (!entry) return null;

      const spec = entry.def.tweenable[prop];
      if (!spec) return null;

      return { obj: entry.proxy, key: prop, kind: spec.kind };
    },

    dispose() {
      composer.dispose();
    },
  };
}
