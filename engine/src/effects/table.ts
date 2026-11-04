// Ported from reacthub-pixitweenjs src/components/AepComposition/Aep3DPostFx.tsx (MIT).
// Effect params for the old 2D filters adapted from src/hooks/useSpriteFilters.ts (MIT).
import {
  BlendFunction,
  BloomEffect,
  BrightnessContrastEffect,
  ChromaticAberrationEffect,
  DepthOfFieldEffect,
  HueSaturationEffect,
  NoiseEffect,
  VignetteEffect,
  ColorAverageEffect,
  DotScreenEffect,
  KawaseBlurPass,
  KernelSize,
  PixelationEffect,
  ScanlineEffect,
  SepiaEffect,
  TiltShiftEffect,
  type Effect,
  type Pass,
} from 'postprocessing';
import * as THREE from 'three';
import type { EffectScope, EffectType } from '../schema';
import { GlowEffect } from './custom/glow';
import { LensStreakEffect, SplitToneEffect } from './custom/grade';
import { DropShadowEffect } from './custom/dropShadow';
import { OutlineEffect2D } from './custom/outline';
import { GaussianBlurPass } from './custom/gaussianBlur';
import { StageDofPass } from './custom/stageDof';

// One table from an effect type to its constructor and tweenable fields, so adding an effect is one
// entry (engine/docs/05-effects.md, "The effect table"). Every field name is checked against
// postprocessing 6.39 (build/types/index.d.ts). Custom 2D effects (glow, dropShadow, outline) are
// registered by R3 through `registerEffect`.

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

export type EffectKind = 'number' | 'deg' | 'color';
export type ParamValue = number | string;

export interface EffectContext {
  camera: THREE.Camera;
  size: { width: number; height: number };
}

export interface TweenableParam<E> {
  kind: EffectKind;
  get(e: E): ParamValue;
  set(e: E, v: ParamValue): void;
}

export interface EffectDef<E extends Effect | Pass = Effect | Pass> {
  type: EffectType;
  scope: EffectScope;
  /** The documented params, merged under a spec's params before `create`. */
  defaults: Record<string, ParamValue>;
  create(params: Record<string, ParamValue>, ctx: EffectContext): E;
  /** Tweenable params: how to read and write each on the live effect (or pass). */
  tweenable: Record<string, TweenableParam<E>>;
}

/** A number param; a string from JSON is parsed, so `"2"` works like `2`. */
export const num = (value: ParamValue | undefined, fallback = 0): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/** Shorthand for a numeric field read and written straight on the effect. */
function field<E>(read: (e: E) => number, write: (e: E, v: number) => void, kind: EffectKind = 'number'): TweenableParam<E> {
  return { kind, get: read, set: (e, v) => write(e, num(v)) };
}

const BLOOM_DEFAULTS = { intensity: 1, threshold: 0.85, smoothing: 0.1, radius: 0.7 };

const bloom: EffectDef<BloomEffect> = {
  type: 'bloom',
  scope: 'any',
  defaults: BLOOM_DEFAULTS,
  create: (params) => {
    const p = { ...BLOOM_DEFAULTS, ...params };
    return new BloomEffect({
      mipmapBlur: true,
      intensity: num(p.intensity),
      luminanceThreshold: num(p.threshold),
      luminanceSmoothing: num(p.smoothing),
      radius: num(p.radius),
    });
  },
  tweenable: {
    intensity: {
      kind: 'number',
      get: (e) => e.intensity,
      set: (e, v) => {
        e.intensity = num(v);
      },
    },
    threshold: {
      kind: 'number',
      get: (e) => e.luminanceMaterial.threshold,
      set: (e, v) => {
        e.luminanceMaterial.threshold = num(v);
      },
    },
    smoothing: {
      kind: 'number',
      get: (e) => e.luminanceMaterial.smoothing,
      set: (e, v) => {
        e.luminanceMaterial.smoothing = num(v);
      },
    },
  },
};

const VIGNETTE_DEFAULTS = { offset: 0.35, darkness: 0.6 };

const vignette: EffectDef<VignetteEffect> = {
  type: 'vignette',
  scope: 'any',
  defaults: VIGNETTE_DEFAULTS,
  create: (params) => {
    const p = { ...VIGNETTE_DEFAULTS, ...params };
    return new VignetteEffect({ offset: num(p.offset), darkness: num(p.darkness) });
  },
  tweenable: {
    offset: {
      kind: 'number',
      get: (e) => e.offset,
      set: (e, v) => {
        e.offset = num(v);
      },
    },
    darkness: {
      kind: 'number',
      get: (e) => e.darkness,
      set: (e, v) => {
        e.darkness = num(v);
      },
    },
  },
};

const CHROMATIC_DEFAULTS = { offsetX: 0.0015, offsetY: 0.0015 };

const chromaticAberration: EffectDef<ChromaticAberrationEffect> = {
  type: 'chromaticAberration',
  scope: 'any',
  defaults: CHROMATIC_DEFAULTS,
  create: (params) => {
    const p = { ...CHROMATIC_DEFAULTS, ...params };
    // postprocessing 6.39's .d.ts marks radialModulation/modulationOffset as required even though
    // they are optional at runtime (defaults false/0.15), so we pass their documented defaults.
    return new ChromaticAberrationEffect({
      offset: new THREE.Vector2(num(p.offsetX), num(p.offsetY)),
      radialModulation: false,
      modulationOffset: 0.15,
    });
  },
  tweenable: {
    offsetX: {
      kind: 'number',
      get: (e) => e.offset.x,
      set: (e, v) => {
        e.offset.x = num(v);
      },
    },
    offsetY: {
      kind: 'number',
      get: (e) => e.offset.y,
      set: (e, v) => {
        e.offset.y = num(v);
      },
    },
  },
};

const NOISE_DEFAULTS = { opacity: 0.15 };

const noise: EffectDef<NoiseEffect> = {
  type: 'noise',
  scope: 'any',
  defaults: NOISE_DEFAULTS,
  create: (params) => {
    const p = { ...NOISE_DEFAULTS, ...params };
    const effect = new NoiseEffect({ blendFunction: BlendFunction.OVERLAY, premultiply: true });
    effect.blendMode.opacity.value = num(p.opacity);
    return effect;
  },
  tweenable: {
    opacity: {
      kind: 'number',
      get: (e) => e.blendMode.opacity.value,
      set: (e, v) => {
        e.blendMode.opacity.value = num(v);
      },
    },
  },
};

const DOF_DEFAULTS = { focusDistance: 5, focusRange: 2, bokehScale: 2 };

const dof: EffectDef<DepthOfFieldEffect> = {
  type: 'dof',
  scope: 'three',
  defaults: DOF_DEFAULTS,
  create: (params, { camera }) => {
    const p = { ...DOF_DEFAULTS, ...params };
    return new DepthOfFieldEffect(camera, {
      focusDistance: num(p.focusDistance),
      focusRange: num(p.focusRange),
      bokehScale: num(p.bokehScale),
    });
  },
  tweenable: {
    focusDistance: {
      kind: 'number',
      get: (e) => e.cocMaterial.worldFocusDistance,
      set: (e, v) => {
        e.cocMaterial.worldFocusDistance = num(v);
      },
    },
    focusRange: {
      kind: 'number',
      get: (e) => e.cocMaterial.worldFocusRange,
      set: (e, v) => {
        e.cocMaterial.worldFocusRange = num(v);
      },
    },
    bokehScale: {
      kind: 'number',
      get: (e) => e.bokehScale,
      set: (e, v) => {
        e.bokehScale = num(v);
      },
    },
  },
};

const BRIGHTNESS_CONTRAST_DEFAULTS = { brightness: 0, contrast: 0 };

const brightnessContrast: EffectDef<BrightnessContrastEffect> = {
  type: 'brightnessContrast',
  scope: 'any',
  defaults: BRIGHTNESS_CONTRAST_DEFAULTS,
  create: (params) => {
    const p = { ...BRIGHTNESS_CONTRAST_DEFAULTS, ...params };
    return new BrightnessContrastEffect({ brightness: num(p.brightness), contrast: num(p.contrast) });
  },
  tweenable: {
    brightness: {
      kind: 'number',
      get: (e) => e.brightness,
      set: (e, v) => {
        e.brightness = num(v);
      },
    },
    contrast: {
      kind: 'number',
      get: (e) => e.contrast,
      set: (e, v) => {
        e.contrast = num(v);
      },
    },
  },
};


const HUE_SATURATION_DEFAULTS = { hue: 0, saturation: 0 };

const hueSaturation: EffectDef<HueSaturationEffect> = {
  type: 'hueSaturation',
  scope: 'any',
  defaults: HUE_SATURATION_DEFAULTS,
  create: (params) => {
    const p = { ...HUE_SATURATION_DEFAULTS, ...params };
    // HueSaturationEffect stores hue in radians; the doc authors degrees.
    return new HueSaturationEffect({ hue: num(p.hue) * DEG_TO_RAD, saturation: num(p.saturation) });
  },
  tweenable: {
    hue: {
      kind: 'deg',
      get: (e) => e.hue * RAD_TO_DEG,
      set: (e, v) => {
        e.hue = num(v) * DEG_TO_RAD;
      },
    },
    saturation: {
      kind: 'number',
      get: (e) => e.saturation,
      set: (e, v) => {
        e.saturation = num(v);
      },
    },
  },
};

const SEPIA_DEFAULTS = { intensity: 1 };

const sepia: EffectDef<SepiaEffect> = {
  type: 'sepia',
  scope: 'any',
  defaults: SEPIA_DEFAULTS,
  create: (params) => new SepiaEffect({ intensity: num({ ...SEPIA_DEFAULTS, ...params }.intensity) }),
  tweenable: {
    intensity: field((e) => e.intensity, (e, v) => (e.intensity = v)),
  },
};

const GRAYSCALE_DEFAULTS = { opacity: 1 };

const grayscale: EffectDef<ColorAverageEffect> = {
  type: 'grayscale',
  scope: 'any',
  defaults: GRAYSCALE_DEFAULTS,
  create: (params) => {
    const effect = new ColorAverageEffect(BlendFunction.NORMAL);
    effect.blendMode.opacity.value = num({ ...GRAYSCALE_DEFAULTS, ...params }.opacity);
    return effect;
  },
  tweenable: {
    opacity: field((e) => e.blendMode.opacity.value, (e, v) => (e.blendMode.opacity.value = v)),
  },
};

const PIXELATE_DEFAULTS = { granularity: 8 };

const pixelate: EffectDef<PixelationEffect> = {
  type: 'pixelate',
  scope: 'any',
  defaults: PIXELATE_DEFAULTS,
  create: (params) => new PixelationEffect(num({ ...PIXELATE_DEFAULTS, ...params }.granularity)),
  tweenable: {
    granularity: field((e) => e.granularity, (e, v) => (e.granularity = v)),
  },
};

const SCANLINES_DEFAULTS = { density: 1.25, opacity: 0.4 };

const scanlines: EffectDef<ScanlineEffect> = {
  type: 'scanlines',
  scope: 'any',
  defaults: SCANLINES_DEFAULTS,
  create: (params) => {
    const p = { ...SCANLINES_DEFAULTS, ...params };
    const effect = new ScanlineEffect({ blendFunction: BlendFunction.OVERLAY, density: num(p.density) });
    effect.blendMode.opacity.value = num(p.opacity);
    return effect;
  },
  tweenable: {
    density: field((e) => e.density, (e, v) => (e.density = v)),
    opacity: field((e) => e.blendMode.opacity.value, (e, v) => (e.blendMode.opacity.value = v)),
  },
};

const DOT_SCREEN_DEFAULTS = { scale: 1, angle: 45 };

const dotScreen: EffectDef<DotScreenEffect> = {
  type: 'dotScreen',
  scope: 'any',
  defaults: DOT_SCREEN_DEFAULTS,
  create: (params) => {
    const p = { ...DOT_SCREEN_DEFAULTS, ...params };
    return new DotScreenEffect({ scale: num(p.scale), angle: num(p.angle) * DEG_TO_RAD });
  },
  tweenable: {
    scale: field((e) => e.scale, (e, v) => (e.scale = v)),
    angle: field((e) => e.angle * RAD_TO_DEG, (e, v) => (e.angle = v * DEG_TO_RAD), 'deg'),
  },
};

const TILT_SHIFT_DEFAULTS = { offset: 0, rotation: 0, focusArea: 0.4, feather: 0.3 };

const tiltShift: EffectDef<TiltShiftEffect> = {
  type: 'tiltShift',
  scope: 'any',
  defaults: TILT_SHIFT_DEFAULTS,
  create: (params) => {
    const p = { ...TILT_SHIFT_DEFAULTS, ...params };
    return new TiltShiftEffect({
      offset: num(p.offset),
      rotation: num(p.rotation) * DEG_TO_RAD,
      focusArea: num(p.focusArea),
      feather: num(p.feather),
    });
  },
  tweenable: {
    offset: field((e) => e.offset, (e, v) => (e.offset = v)),
    rotation: field((e) => e.rotation * RAD_TO_DEG, (e, v) => (e.rotation = v * DEG_TO_RAD), 'deg'),
    focusArea: field((e) => e.focusArea, (e, v) => (e.focusArea = v)),
    feather: field((e) => e.feather, (e, v) => (e.feather = v)),
  },
};

const BLUR_DEFAULTS = { scale: 1 };

/** `blur` is a Pass, not an Effect: the chain inserts it before the EffectPass. */
const blur: EffectDef<KawaseBlurPass> = {
  type: 'blur',
  scope: 'any',
  defaults: BLUR_DEFAULTS,
  create: (params) => {
    const pass = new KawaseBlurPass({ kernelSize: KernelSize.MEDIUM });
    pass.scale = num({ ...BLUR_DEFAULTS, ...params }.scale);
    return pass;
  },
  tweenable: {
    scale: field((e) => e.scale, (e, v) => (e.scale = v)),
  },
};

const GAUSSIAN_BLUR_DEFAULTS = { strength: 8 };

/** pixi.js BlurFilter look (the AEP `gaussian-blur` effect): `strength` is the filter's strength in px. */
const gaussianBlur: EffectDef<GaussianBlurPass> = {
  type: 'gaussianBlur',
  scope: 'any',
  defaults: GAUSSIAN_BLUR_DEFAULTS,
  create: (params) => new GaussianBlurPass(num({ ...GAUSSIAN_BLUR_DEFAULTS, ...params }.strength)),
  tweenable: {
    strength: field((e) => e.strength, (e, v) => (e.strength = v)),
  },
};

const STAGE_DOF_DEFAULTS = { aperture: 0.3, focusDistance: 1, bokeh: 0 };

/** The stage world's depth of field (circle-of-confusion gather); focusDistance in world units. */
const stageDof: EffectDef<StageDofPass> = {
  type: 'stageDof',
  scope: 'three',
  defaults: STAGE_DOF_DEFAULTS,
  create: (params, { camera }) => {
    const p = { ...STAGE_DOF_DEFAULTS, ...params };
    return new StageDofPass(camera, num(p.aperture), num(p.focusDistance), num(p.bokeh));
  },
  tweenable: {
    aperture: field((e) => e.aperture, (e, v) => (e.aperture = v)),
    focusDistance: field((e) => e.focusDistance, (e, v) => (e.focusDistance = v)),
    bokeh: field((e) => e.bokeh, (e, v) => (e.bokeh = v)),
  },
};

const SPLIT_TONE_DEFAULTS = { shadows: '#1d4a6b', highlights: '#ffb877', amount: 0.5, balance: 0 };

const colorParam = <E>(read: (e: E) => string, write: (e: E, v: string) => void): TweenableParam<E> => ({ kind: 'color', get: read, set: (e, v) => write(e, String(v)) });

const splitTone: EffectDef<SplitToneEffect> = {
  type: 'splitTone',
  scope: 'any',
  defaults: SPLIT_TONE_DEFAULTS,
  create: (params) => {
    const p = { ...SPLIT_TONE_DEFAULTS, ...params };
    return new SplitToneEffect({ shadows: String(p.shadows), highlights: String(p.highlights), amount: num(p.amount), balance: num(p.balance) });
  },
  tweenable: {
    shadows: colorParam((e) => e.shadows, (e, v) => (e.shadows = v)),
    highlights: colorParam((e) => e.highlights, (e, v) => (e.highlights = v)),
    amount: field((e) => e.amount, (e, v) => (e.amount = v)),
    balance: field((e) => e.balance, (e, v) => (e.balance = v)),
  },
};

const LENS_STREAK_DEFAULTS = { color: '#7fb2ff', strength: 0.5, threshold: 0.8, reach: 0.3 };

const lensStreak: EffectDef<LensStreakEffect> = {
  type: 'lensStreak',
  scope: 'any',
  defaults: LENS_STREAK_DEFAULTS,
  create: (params) => {
    const p = { ...LENS_STREAK_DEFAULTS, ...params };
    return new LensStreakEffect({ color: String(p.color), strength: num(p.strength), threshold: num(p.threshold), reach: num(p.reach) });
  },
  tweenable: {
    color: colorParam((e) => e.color, (e, v) => (e.color = v)),
    strength: field((e) => e.strength, (e, v) => (e.strength = v)),
    threshold: field((e) => e.threshold, (e, v) => (e.threshold = v)),
    reach: field((e) => e.reach, (e, v) => (e.reach = v)),
  },
};

const GLOW_DEFAULTS = { color: '#ffffff', strength: 2, distance: 10 };

const glow: EffectDef<GlowEffect> = {
  type: 'glow',
  scope: '2d',
  defaults: GLOW_DEFAULTS,
  create: (params) => {
    const p = { ...GLOW_DEFAULTS, ...params };
    return new GlowEffect({ color: String(p.color), strength: num(p.strength), distance: num(p.distance) });
  },
  tweenable: {
    color: {
      kind: 'color',
      get: (e) => e.color,
      set: (e, v) => {
        e.color = String(v);
      },
    },
    strength: field((e) => e.strength, (e, v) => (e.strength = v)),
    distance: field((e) => e.distance, (e, v) => (e.distance = v)),
  },
};

const DROP_SHADOW_DEFAULTS = { color: '#000000', alpha: 0.5, distance: 6, angle: 45, blur: 4 };

const dropShadow: EffectDef<DropShadowEffect> = {
  type: 'dropShadow',
  scope: '2d',
  defaults: DROP_SHADOW_DEFAULTS,
  create: (params) => {
    const p = { ...DROP_SHADOW_DEFAULTS, ...params };
    return new DropShadowEffect({
      color: String(p.color),
      alpha: num(p.alpha),
      distance: num(p.distance),
      angle: num(p.angle),
      blur: num(p.blur),
    });
  },
  tweenable: {
    color: {
      kind: 'color',
      get: (e) => e.color,
      set: (e, v) => {
        e.color = String(v);
      },
    },
    alpha: field((e) => e.alpha, (e, v) => (e.alpha = v)),
    distance: field((e) => e.distance, (e, v) => (e.distance = v)),
    angle: field((e) => e.angle, (e, v) => (e.angle = v), 'deg'),
    blur: field((e) => e.blur, (e, v) => (e.blur = v)),
  },
};

const OUTLINE_DEFAULTS = { color: '#000000', thickness: 2, alpha: 1 };

const outline: EffectDef<OutlineEffect2D> = {
  type: 'outline',
  scope: '2d',
  defaults: OUTLINE_DEFAULTS,
  create: (params) => {
    const p = { ...OUTLINE_DEFAULTS, ...params };
    return new OutlineEffect2D({ color: String(p.color), thickness: num(p.thickness), alpha: num(p.alpha) });
  },
  tweenable: {
    color: {
      kind: 'color',
      get: (e) => e.color,
      set: (e, v) => {
        e.color = String(v);
      },
    },
    thickness: field((e) => e.thickness, (e, v) => (e.thickness = v)),
    alpha: field((e) => e.alpha, (e, v) => (e.alpha = v)),
  },
};

/** Every effect type. */
export const EFFECTS: Partial<Record<EffectType, EffectDef>> = {
  bloom,
  vignette,
  chromaticAberration,
  noise,
  brightnessContrast,
  hueSaturation,
  sepia,
  grayscale,
  pixelate,
  scanlines,
  dotScreen,
  tiltShift,
  blur,
  gaussianBlur,
  stageDof,
  splitTone,
  lensStreak,
  dof,
  glow,
  dropShadow,
  outline,
} as Partial<Record<EffectType, EffectDef>>;

/** A pixel reach per effect type: glow's distance, dropShadow's distance+blur, outline's thickness,
 * a flat 32px for the blur pass, 0 for everything else (engine/docs/05-effects.md, "Layer isolation"). */
export function effectReach(spec: { type: EffectType; params?: Record<string, ParamValue> }): number {
  const p = spec.params ?? {};
  switch (spec.type) {
    case 'glow':
      return num(p.distance, GLOW_DEFAULTS.distance);
    case 'dropShadow':
      return num(p.distance, DROP_SHADOW_DEFAULTS.distance) + num(p.blur, DROP_SHADOW_DEFAULTS.blur);
    case 'outline':
      return num(p.thickness, OUTLINE_DEFAULTS.thickness);
    case 'blur':
      return 32;
    case 'gaussianBlur':
      return GaussianBlurPass.reach(num(p.strength, GAUSSIAN_BLUR_DEFAULTS.strength));
    default:
      return 0;
  }
}

/** The padding an isolated node needs to fit every effect's reach, rounded up to whole pixels. */
export function padding(specs: Array<{ type: EffectType; params?: Record<string, ParamValue> }>): number {
  return Math.ceil(specs.reduce((max, spec) => Math.max(max, effectReach(spec)), 0));
}

export function registerEffect(def: EffectDef): void {
  EFFECTS[def.type] = def;
}

/** True for effect types implemented as a Pass (run before the EffectPass) rather than an Effect. */
export const PASS_EFFECTS: ReadonlySet<EffectType> = new Set<EffectType>(['blur', 'gaussianBlur', 'stageDof']);
