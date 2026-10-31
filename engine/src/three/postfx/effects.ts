// Ported from reacthub-pixitweenjs src/components/AepComposition/Aep3DPostFx.tsx (MIT).
import {
  BlendFunction,
  BloomEffect,
  BrightnessContrastEffect,
  ChromaticAberrationEffect,
  DepthOfFieldEffect,
  HueSaturationEffect,
  NoiseEffect,
  VignetteEffect,
  type Effect,
} from 'postprocessing';
import * as THREE from 'three';
import type { PostFxType } from '../../schema';

// One table from a `postFx` type to its effect constructor and tweenable fields, so adding a
// post-processing effect is one entry (engine/docs/05-filters-postfx.md, "3D post-processing chain").
// Every field name is checked against postprocessing 6.39 (build/types/index.d.ts).

export type PostFxKind = 'number' | 'deg';

export interface PostFxDef<E extends Effect = Effect> {
  type: PostFxType;
  /** The documented params, merged under a spec's params inside `create`. */
  defaults: Record<string, number>;
  /** `params` are merged with the defaults first; only `dof` needs the camera. */
  create(params: Record<string, number>, camera: THREE.Camera): E;
  /** Tweenable params: how to read and write each on the live effect. */
  tweenable: Record<string, { kind: PostFxKind; get(e: E): number; set(e: E, v: number): void }>;
}

const BLOOM_DEFAULTS = { intensity: 1, threshold: 0.85, smoothing: 0.1, radius: 0.7 };

const bloom: PostFxDef<BloomEffect> = {
  type: 'bloom',
  defaults: BLOOM_DEFAULTS,
  create: (params) => {
    const p: Record<string, number> = { ...BLOOM_DEFAULTS, ...params };
    return new BloomEffect({
      mipmapBlur: true,
      intensity: p.intensity,
      luminanceThreshold: p.threshold,
      luminanceSmoothing: p.smoothing,
      radius: p.radius,
    });
  },
  tweenable: {
    intensity: {
      kind: 'number',
      get: (e) => e.intensity,
      set: (e, v) => {
        e.intensity = v;
      },
    },
    threshold: {
      kind: 'number',
      get: (e) => e.luminanceMaterial.threshold,
      set: (e, v) => {
        e.luminanceMaterial.threshold = v;
      },
    },
    smoothing: {
      kind: 'number',
      get: (e) => e.luminanceMaterial.smoothing,
      set: (e, v) => {
        e.luminanceMaterial.smoothing = v;
      },
    },
  },
};

const VIGNETTE_DEFAULTS = { offset: 0.35, darkness: 0.6 };

const vignette: PostFxDef<VignetteEffect> = {
  type: 'vignette',
  defaults: VIGNETTE_DEFAULTS,
  create: (params) => {
    const p: Record<string, number> = { ...VIGNETTE_DEFAULTS, ...params };
    return new VignetteEffect({ offset: p.offset, darkness: p.darkness });
  },
  tweenable: {
    offset: {
      kind: 'number',
      get: (e) => e.offset,
      set: (e, v) => {
        e.offset = v;
      },
    },
    darkness: {
      kind: 'number',
      get: (e) => e.darkness,
      set: (e, v) => {
        e.darkness = v;
      },
    },
  },
};

const CHROMATIC_DEFAULTS = { offsetX: 0.0015, offsetY: 0.0015 };

const chromaticAberration: PostFxDef<ChromaticAberrationEffect> = {
  type: 'chromaticAberration',
  defaults: CHROMATIC_DEFAULTS,
  create: (params) => {
    const p: Record<string, number> = { ...CHROMATIC_DEFAULTS, ...params };
    // postprocessing 6.39's .d.ts marks radialModulation/modulationOffset as required even though
    // they are optional at runtime (defaults false/0.15), so we pass their documented defaults.
    return new ChromaticAberrationEffect({
      offset: new THREE.Vector2(p.offsetX, p.offsetY),
      radialModulation: false,
      modulationOffset: 0.15,
    });
  },
  tweenable: {
    offsetX: {
      kind: 'number',
      get: (e) => e.offset.x,
      set: (e, v) => {
        e.offset.x = v;
      },
    },
    offsetY: {
      kind: 'number',
      get: (e) => e.offset.y,
      set: (e, v) => {
        e.offset.y = v;
      },
    },
  },
};

const NOISE_DEFAULTS = { opacity: 0.15 };

const noise: PostFxDef<NoiseEffect> = {
  type: 'noise',
  defaults: NOISE_DEFAULTS,
  create: (params) => {
    const p: Record<string, number> = { ...NOISE_DEFAULTS, ...params };
    const effect = new NoiseEffect({ blendFunction: BlendFunction.OVERLAY, premultiply: true });
    effect.blendMode.opacity.value = p.opacity;
    return effect;
  },
  tweenable: {
    opacity: {
      kind: 'number',
      get: (e) => e.blendMode.opacity.value,
      set: (e, v) => {
        e.blendMode.opacity.value = v;
      },
    },
  },
};

const DOF_DEFAULTS = { focusDistance: 5, focusRange: 2, bokehScale: 2 };

const dof: PostFxDef<DepthOfFieldEffect> = {
  type: 'dof',
  defaults: DOF_DEFAULTS,
  create: (params, camera) => {
    const p: Record<string, number> = { ...DOF_DEFAULTS, ...params };
    return new DepthOfFieldEffect(camera, {
      focusDistance: p.focusDistance,
      focusRange: p.focusRange,
      bokehScale: p.bokehScale,
    });
  },
  tweenable: {
    focusDistance: {
      kind: 'number',
      get: (e) => e.cocMaterial.worldFocusDistance,
      set: (e, v) => {
        e.cocMaterial.worldFocusDistance = v;
      },
    },
    focusRange: {
      kind: 'number',
      get: (e) => e.cocMaterial.worldFocusRange,
      set: (e, v) => {
        e.cocMaterial.worldFocusRange = v;
      },
    },
    bokehScale: {
      kind: 'number',
      get: (e) => e.bokehScale,
      set: (e, v) => {
        e.bokehScale = v;
      },
    },
  },
};

const BRIGHTNESS_CONTRAST_DEFAULTS = { brightness: 0, contrast: 0 };

const brightnessContrast: PostFxDef<BrightnessContrastEffect> = {
  type: 'brightnessContrast',
  defaults: BRIGHTNESS_CONTRAST_DEFAULTS,
  create: (params) => {
    const p: Record<string, number> = { ...BRIGHTNESS_CONTRAST_DEFAULTS, ...params };
    return new BrightnessContrastEffect({ brightness: p.brightness, contrast: p.contrast });
  },
  tweenable: {
    brightness: {
      kind: 'number',
      get: (e) => e.brightness,
      set: (e, v) => {
        e.brightness = v;
      },
    },
    contrast: {
      kind: 'number',
      get: (e) => e.contrast,
      set: (e, v) => {
        e.contrast = v;
      },
    },
  },
};

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

const HUE_SATURATION_DEFAULTS = { hue: 0, saturation: 0 };

const hueSaturation: PostFxDef<HueSaturationEffect> = {
  type: 'hueSaturation',
  defaults: HUE_SATURATION_DEFAULTS,
  create: (params) => {
    const p: Record<string, number> = { ...HUE_SATURATION_DEFAULTS, ...params };
    // HueSaturationEffect stores hue in radians; the doc authors degrees.
    return new HueSaturationEffect({ hue: p.hue * DEG_TO_RAD, saturation: p.saturation });
  },
  tweenable: {
    hue: {
      kind: 'deg',
      get: (e) => e.hue * RAD_TO_DEG,
      set: (e, v) => {
        e.hue = v * DEG_TO_RAD;
      },
    },
    saturation: {
      kind: 'number',
      get: (e) => e.saturation,
      set: (e, v) => {
        e.saturation = v;
      },
    },
  },
};

export const POSTFX_DEFS = {
  bloom,
  vignette,
  chromaticAberration,
  noise,
  dof,
  brightnessContrast,
  hueSaturation,
} satisfies Record<PostFxType, PostFxDef>;
