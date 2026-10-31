// Ported from reacthub-pixitweenjs src/hooks/withFiltersHook.tsx and withEffectsHook.tsx (MIT).
import { BlurFilter, Color, ColorMatrixFilter, NoiseFilter, type ColorSource, type Filter } from 'pixi.js';
import {
  AdjustmentFilter,
  AdvancedBloomFilter,
  CRTFilter,
  DropShadowFilter,
  GlitchFilter,
  GlowFilter,
  GodrayFilter,
  OldFilmFilter,
  OutlineFilter,
  PixelateFilter,
  RGBSplitFilter,
  ZoomBlurFilter,
} from 'pixi-filters';
import type { Filter2DType } from '../schema';
import { seedFor } from '../core/seed';
import { withSeededRandom } from './seeded';

export type ParamValue = number | string | boolean;

export interface FilterDef<F extends Filter = Filter> {
  type: Filter2DType;
  defaults: Record<string, ParamValue>;
  /** params are already merged with defaults. */
  create(params: Record<string, ParamValue>): F;
  /** Tweenable params: how to read and write each on the live filter. */
  tweenable: Record<
    string,
    { kind: 'number' | 'color'; get(f: F): number | string; set(f: F, v: number | string): void }
  >;
  /** Time-driven filters: called on every clock update. */
  tick?(f: F, timeSec: number, frame: number, salt: number): void;
}

function num(params: Record<string, ParamValue>, key: string, fallback: number): number {
  const value = params[key];
  return typeof value === 'number' ? value : fallback;
}

function colorSource(params: Record<string, ParamValue>, key: string, fallback: string): ColorSource {
  const value = params[key];
  return typeof value === 'number' || typeof value === 'string' ? value : fallback;
}

/** Normalise any pixi colour to a lowercase #rrggbb string. */
function toHex(value: ColorSource): string {
  return new Color(value).toHex();
}

const blur: FilterDef<BlurFilter> = {
  type: 'blur',
  defaults: { strength: 8, quality: 4 },
  create: (params) => new BlurFilter({ strength: num(params, 'strength', 8), quality: num(params, 'quality', 4) }),
  tweenable: {
    strength: {
      kind: 'number',
      get: (f) => f.strength,
      set: (f, v) => {
        f.strength = v as number;
      },
    },
  },
};

const glow: FilterDef<GlowFilter> = {
  type: 'glow',
  defaults: { distance: 10, outerStrength: 2, innerStrength: 0, color: '#ffffff', alpha: 1, quality: 0.2 },
  create: (params) =>
    new GlowFilter({
      distance: num(params, 'distance', 10),
      outerStrength: num(params, 'outerStrength', 2),
      innerStrength: num(params, 'innerStrength', 0),
      color: colorSource(params, 'color', '#ffffff'),
      alpha: num(params, 'alpha', 1),
      quality: num(params, 'quality', 0.2),
    }),
  tweenable: {
    outerStrength: {
      kind: 'number',
      get: (f) => f.outerStrength,
      set: (f, v) => {
        f.outerStrength = v as number;
      },
    },
    innerStrength: {
      kind: 'number',
      get: (f) => f.innerStrength,
      set: (f, v) => {
        f.innerStrength = v as number;
      },
    },
    color: {
      kind: 'color',
      get: (f) => toHex(f.color),
      set: (f, v) => {
        f.color = v;
      },
    },
    alpha: {
      kind: 'number',
      get: (f) => f.alpha,
      set: (f, v) => {
        f.alpha = v as number;
      },
    },
  },
};

const bloom: FilterDef<AdvancedBloomFilter> = {
  type: 'bloom',
  defaults: { threshold: 0.5, bloomScale: 1, brightness: 1, blur: 8, quality: 4 },
  create: (params) =>
    new AdvancedBloomFilter({
      threshold: num(params, 'threshold', 0.5),
      bloomScale: num(params, 'bloomScale', 1),
      brightness: num(params, 'brightness', 1),
      blur: num(params, 'blur', 8),
      quality: num(params, 'quality', 4),
    }),
  tweenable: {
    threshold: {
      kind: 'number',
      get: (f) => f.threshold,
      set: (f, v) => {
        f.threshold = v as number;
      },
    },
    bloomScale: {
      kind: 'number',
      get: (f) => f.bloomScale,
      set: (f, v) => {
        f.bloomScale = v as number;
      },
    },
    brightness: {
      kind: 'number',
      get: (f) => f.brightness,
      set: (f, v) => {
        f.brightness = v as number;
      },
    },
    blur: {
      kind: 'number',
      get: (f) => f.blur,
      set: (f, v) => {
        f.blur = v as number;
      },
    },
  },
};

const dropShadow: FilterDef<DropShadowFilter> = {
  type: 'dropShadow',
  defaults: { offsetX: 4, offsetY: 4, blur: 2, alpha: 0.5, color: '#000000' },
  create: (params) =>
    new DropShadowFilter({
      offset: { x: num(params, 'offsetX', 4), y: num(params, 'offsetY', 4) },
      blur: num(params, 'blur', 2),
      alpha: num(params, 'alpha', 0.5),
      color: colorSource(params, 'color', '#000000'),
    }),
  tweenable: {
    offsetX: {
      kind: 'number',
      get: (f) => f.offsetX,
      set: (f, v) => {
        f.offsetX = v as number;
      },
    },
    offsetY: {
      kind: 'number',
      get: (f) => f.offsetY,
      set: (f, v) => {
        f.offsetY = v as number;
      },
    },
    blur: {
      kind: 'number',
      get: (f) => f.blur,
      set: (f, v) => {
        f.blur = v as number;
      },
    },
    alpha: {
      kind: 'number',
      get: (f) => f.alpha,
      set: (f, v) => {
        f.alpha = v as number;
      },
    },
    color: {
      kind: 'color',
      get: (f) => toHex(f.color),
      set: (f, v) => {
        f.color = v;
      },
    },
  },
};

const adjustment: FilterDef<AdjustmentFilter> = {
  type: 'adjustment',
  defaults: { brightness: 1, contrast: 1, saturation: 1, gamma: 1, red: 1, green: 1, blue: 1, alpha: 1 },
  create: (params) =>
    new AdjustmentFilter({
      brightness: num(params, 'brightness', 1),
      contrast: num(params, 'contrast', 1),
      saturation: num(params, 'saturation', 1),
      gamma: num(params, 'gamma', 1),
      red: num(params, 'red', 1),
      green: num(params, 'green', 1),
      blue: num(params, 'blue', 1),
      alpha: num(params, 'alpha', 1),
    }),
  tweenable: {
    brightness: {
      kind: 'number',
      get: (f) => f.brightness,
      set: (f, v) => {
        f.brightness = v as number;
      },
    },
    contrast: {
      kind: 'number',
      get: (f) => f.contrast,
      set: (f, v) => {
        f.contrast = v as number;
      },
    },
    saturation: {
      kind: 'number',
      get: (f) => f.saturation,
      set: (f, v) => {
        f.saturation = v as number;
      },
    },
    gamma: {
      kind: 'number',
      get: (f) => f.gamma,
      set: (f, v) => {
        f.gamma = v as number;
      },
    },
    red: {
      kind: 'number',
      get: (f) => f.red,
      set: (f, v) => {
        f.red = v as number;
      },
    },
    green: {
      kind: 'number',
      get: (f) => f.green,
      set: (f, v) => {
        f.green = v as number;
      },
    },
    blue: {
      kind: 'number',
      get: (f) => f.blue,
      set: (f, v) => {
        f.blue = v as number;
      },
    },
    alpha: {
      kind: 'number',
      get: (f) => f.alpha,
      set: (f, v) => {
        f.alpha = v as number;
      },
    },
  },
};

const outline: FilterDef<OutlineFilter> = {
  type: 'outline',
  defaults: { thickness: 2, color: '#000000', alpha: 1 },
  create: (params) =>
    new OutlineFilter({
      thickness: num(params, 'thickness', 2),
      color: colorSource(params, 'color', '#000000'),
      alpha: num(params, 'alpha', 1),
    }),
  tweenable: {
    thickness: {
      kind: 'number',
      get: (f) => f.thickness,
      set: (f, v) => {
        f.thickness = v as number;
      },
    },
    color: {
      kind: 'color',
      get: (f) => toHex(f.color),
      set: (f, v) => {
        f.color = v;
      },
    },
    alpha: {
      kind: 'number',
      get: (f) => f.alpha,
      set: (f, v) => {
        f.alpha = v as number;
      },
    },
  },
};

const COLOR_MATRIX_PRESET_NAMES = [
  'none',
  'grayscale',
  'sepia',
  'vintage',
  'polaroid',
  'kodachrome',
  'technicolor',
  'browni',
  'negative',
  'lsd',
] as const;

type ColorMatrixPreset = (typeof COLOR_MATRIX_PRESET_NAMES)[number];

// Each preset is the matching ColorMatrixFilter method. `grayscale` takes a
// per-channel weight, so 1/3 is the full, luminance-average greyscale.
const COLOR_MATRIX_PRESETS: Record<ColorMatrixPreset, (f: ColorMatrixFilter) => void> = {
  none: () => {},
  grayscale: (f) => f.grayscale(1 / 3, false),
  sepia: (f) => f.sepia(false),
  vintage: (f) => f.vintage(false),
  polaroid: (f) => f.polaroid(false),
  kodachrome: (f) => f.kodachrome(false),
  technicolor: (f) => f.technicolor(false),
  browni: (f) => f.browni(false),
  negative: (f) => f.negative(false),
  lsd: (f) => f.lsd(false),
};

const IDENTITY_MATRIX = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0];

interface ColorMatrixState {
  preset: ColorMatrixPreset;
  amount: number;
  hue: number;
}

// preset/amount/hue are not fields on the pixi filter, so they live beside it.
const colorMatrixState = new WeakMap<ColorMatrixFilter, ColorMatrixState>();

function colorMatrixStateOf(f: ColorMatrixFilter): ColorMatrixState {
  let state = colorMatrixState.get(f);
  if (!state) {
    state = { preset: 'none', amount: 1, hue: 0 };
    colorMatrixState.set(f, state);
  }
  return state;
}

function colorMatrixPreset(params: Record<string, ParamValue>): ColorMatrixPreset {
  const value = params.preset;
  return typeof value === 'string' && (COLOR_MATRIX_PRESET_NAMES as readonly string[]).includes(value)
    ? (value as ColorMatrixPreset)
    : 'none';
}

/** reset() -> preset -> amount mix toward identity -> hue; always replaces the matrix array. */
function rebuildColorMatrix(f: ColorMatrixFilter): void {
  const state = colorMatrixStateOf(f);
  f.reset();
  COLOR_MATRIX_PRESETS[state.preset](f);
  if (state.amount !== 1) {
    f.matrix = f.matrix.map(
      (value, i) => IDENTITY_MATRIX[i] + (value - IDENTITY_MATRIX[i]) * state.amount,
    ) as typeof f.matrix;
  }
  if (state.hue !== 0) {
    f.hue(state.hue, true);
  }
}

const colorMatrix: FilterDef<ColorMatrixFilter> = {
  type: 'colorMatrix',
  defaults: { preset: 'none', amount: 1, hue: 0 },
  create: (params) => {
    const filter = new ColorMatrixFilter();
    colorMatrixState.set(filter, {
      preset: colorMatrixPreset(params),
      amount: num(params, 'amount', 1),
      hue: num(params, 'hue', 0),
    });
    rebuildColorMatrix(filter);
    return filter;
  },
  tweenable: {
    amount: {
      kind: 'number',
      get: (f) => colorMatrixStateOf(f).amount,
      set: (f, v) => {
        colorMatrixStateOf(f).amount = v as number;
        rebuildColorMatrix(f);
      },
    },
    hue: {
      kind: 'number',
      get: (f) => colorMatrixStateOf(f).hue,
      set: (f, v) => {
        colorMatrixStateOf(f).hue = v as number;
        rebuildColorMatrix(f);
      },
    },
  },
};

const noise: FilterDef<NoiseFilter> = {
  type: 'noise',
  defaults: { noise: 0.2 },
  create: (params) => new NoiseFilter({ noise: num(params, 'noise', 0.2) }),
  tweenable: {
    noise: {
      kind: 'number',
      get: (f) => f.noise,
      set: (f, v) => {
        f.noise = v as number;
      },
    },
  },
  tick: (f, _timeSec, frame, salt) => {
    f.seed = seedFor(frame, salt);
  },
};

const rgbSplit: FilterDef<RGBSplitFilter> = {
  type: 'rgbSplit',
  defaults: { redX: -4, redY: 0, greenX: 0, greenY: 4, blueX: 0, blueY: 0 },
  create: (params) =>
    new RGBSplitFilter({
      red: { x: num(params, 'redX', -4), y: num(params, 'redY', 0) },
      green: { x: num(params, 'greenX', 0), y: num(params, 'greenY', 4) },
      blue: { x: num(params, 'blueX', 0), y: num(params, 'blueY', 0) },
    }),
  tweenable: {
    redX: {
      kind: 'number',
      get: (f) => f.redX,
      set: (f, v) => {
        f.redX = v as number;
      },
    },
    redY: {
      kind: 'number',
      get: (f) => f.redY,
      set: (f, v) => {
        f.redY = v as number;
      },
    },
    greenX: {
      kind: 'number',
      get: (f) => f.greenX,
      set: (f, v) => {
        f.greenX = v as number;
      },
    },
    greenY: {
      kind: 'number',
      get: (f) => f.greenY,
      set: (f, v) => {
        f.greenY = v as number;
      },
    },
    blueX: {
      kind: 'number',
      get: (f) => f.blueX,
      set: (f, v) => {
        f.blueX = v as number;
      },
    },
    blueY: {
      kind: 'number',
      get: (f) => f.blueY,
      set: (f, v) => {
        f.blueY = v as number;
      },
    },
  },
};

const pixelate: FilterDef<PixelateFilter> = {
  type: 'pixelate',
  defaults: { size: 8 },
  create: (params) => new PixelateFilter(num(params, 'size', 8)),
  tweenable: {
    size: {
      kind: 'number',
      get: (f) => f.sizeX,
      set: (f, v) => {
        f.size = v as number;
      },
    },
  },
};

const zoomBlur: FilterDef<ZoomBlurFilter> = {
  type: 'zoomBlur',
  defaults: { strength: 0.1, centerX: 960, centerY: 540, innerRadius: 0 },
  create: (params) =>
    new ZoomBlurFilter({
      strength: num(params, 'strength', 0.1),
      center: { x: num(params, 'centerX', 960), y: num(params, 'centerY', 540) },
      innerRadius: num(params, 'innerRadius', 0),
    }),
  tweenable: {
    strength: {
      kind: 'number',
      get: (f) => f.strength,
      set: (f, v) => {
        f.strength = v as number;
      },
    },
    innerRadius: {
      kind: 'number',
      get: (f) => f.innerRadius,
      set: (f, v) => {
        f.innerRadius = v as number;
      },
    },
    centerX: {
      kind: 'number',
      get: (f) => f.centerX,
      set: (f, v) => {
        f.centerX = v as number;
      },
    },
    centerY: {
      kind: 'number',
      get: (f) => f.centerY,
      set: (f, v) => {
        f.centerY = v as number;
      },
    },
  },
};

const crt: FilterDef<CRTFilter> = {
  type: 'crt',
  defaults: { curvature: 1, lineWidth: 1, lineContrast: 0.25, noise: 0.3, vignetting: 0.3 },
  create: (params) =>
    new CRTFilter({
      curvature: num(params, 'curvature', 1),
      lineWidth: num(params, 'lineWidth', 1),
      lineContrast: num(params, 'lineContrast', 0.25),
      noise: num(params, 'noise', 0.3),
      vignetting: num(params, 'vignetting', 0.3),
    }),
  tweenable: {
    curvature: {
      kind: 'number',
      get: (f) => f.curvature,
      set: (f, v) => {
        f.curvature = v as number;
      },
    },
    lineContrast: {
      kind: 'number',
      get: (f) => f.lineContrast,
      set: (f, v) => {
        f.lineContrast = v as number;
      },
    },
    noise: {
      kind: 'number',
      get: (f) => f.noise,
      set: (f, v) => {
        f.noise = v as number;
      },
    },
    vignetting: {
      kind: 'number',
      get: (f) => f.vignetting,
      set: (f, v) => {
        f.vignetting = v as number;
      },
    },
  },
  tick: (f, timeSec, frame, salt) => {
    f.time = timeSec;
    f.seed = seedFor(frame, salt);
  },
};

const oldFilm: FilterDef<OldFilmFilter> = {
  type: 'oldFilm',
  defaults: { sepia: 0.3, noise: 0.3, scratch: 0.5, vignetting: 0.3 },
  create: (params) =>
    new OldFilmFilter({
      sepia: num(params, 'sepia', 0.3),
      noise: num(params, 'noise', 0.3),
      scratch: num(params, 'scratch', 0.5),
      vignetting: num(params, 'vignetting', 0.3),
    }),
  tweenable: {
    sepia: {
      kind: 'number',
      get: (f) => f.sepia,
      set: (f, v) => {
        f.sepia = v as number;
      },
    },
    noise: {
      kind: 'number',
      get: (f) => f.noise,
      set: (f, v) => {
        f.noise = v as number;
      },
    },
    scratch: {
      kind: 'number',
      get: (f) => f.scratch,
      set: (f, v) => {
        f.scratch = v as number;
      },
    },
    vignetting: {
      kind: 'number',
      get: (f) => f.vignetting,
      set: (f, v) => {
        f.vignetting = v as number;
      },
    },
  },
  tick: (f, _timeSec, frame, salt) => {
    f.seed = seedFor(frame, salt);
  },
};

const godray: FilterDef<GodrayFilter> = {
  type: 'godray',
  defaults: { angle: 30, gain: 0.5, lacunarity: 2.5, alpha: 1 },
  create: (params) =>
    new GodrayFilter({
      angle: num(params, 'angle', 30),
      gain: num(params, 'gain', 0.5),
      lacunarity: num(params, 'lacunarity', 2.5),
      alpha: num(params, 'alpha', 1),
    }),
  tweenable: {
    angle: {
      kind: 'number',
      get: (f) => f.angle,
      set: (f, v) => {
        f.angle = v as number;
      },
    },
    gain: {
      kind: 'number',
      get: (f) => f.gain,
      set: (f, v) => {
        f.gain = v as number;
      },
    },
    alpha: {
      kind: 'number',
      get: (f) => f.alpha,
      set: (f, v) => {
        f.alpha = v as number;
      },
    },
  },
  tick: (f, timeSec) => {
    f.time = timeSec;
  },
};

const glitch: FilterDef<GlitchFilter> = {
  type: 'glitch',
  defaults: { slices: 8, offset: 40, direction: 0 },
  create: (params) =>
    new GlitchFilter({
      slices: num(params, 'slices', 8),
      offset: num(params, 'offset', 40),
      direction: num(params, 'direction', 0),
    }),
  tweenable: {
    offset: {
      kind: 'number',
      get: (f) => f.offset,
      set: (f, v) => {
        f.offset = v as number;
      },
    },
    direction: {
      kind: 'number',
      get: (f) => f.direction,
      set: (f, v) => {
        f.direction = v as number;
      },
    },
  },
  tick: (f, _timeSec, frame, salt) => {
    withSeededRandom(seedFor(frame, salt), () => f.refresh());
  },
};

export const FILTERS = {
  blur,
  glow,
  bloom,
  dropShadow,
  adjustment,
  outline,
  colorMatrix,
  noise,
  rgbSplit,
  pixelate,
  zoomBlur,
  crt,
  oldFilm,
  godray,
  glitch,
} satisfies Record<Filter2DType, FilterDef>;
