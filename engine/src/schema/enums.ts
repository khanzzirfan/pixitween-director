import { z } from 'zod';

export type PresetKind = 'enter' | 'exit' | 'loop';

export const PRESET_NAMES = [
  { name: 'fadeIn', kind: 'enter' },
  { name: 'fadeInUp', kind: 'enter' },
  { name: 'fadeInDown', kind: 'enter' },
  { name: 'fadeInLeft', kind: 'enter' },
  { name: 'fadeInRight', kind: 'enter' },
  { name: 'slideInUp', kind: 'enter' },
  { name: 'slideInDown', kind: 'enter' },
  { name: 'slideInLeft', kind: 'enter' },
  { name: 'slideInRight', kind: 'enter' },
  { name: 'zoomIn', kind: 'enter' },
  { name: 'popIn', kind: 'enter' },
  { name: 'rotateIn', kind: 'enter' },
  { name: 'dropIn', kind: 'enter' },
  { name: 'fadeOut', kind: 'exit' },
  { name: 'fadeOutUp', kind: 'exit' },
  { name: 'fadeOutDown', kind: 'exit' },
  { name: 'slideOutLeft', kind: 'exit' },
  { name: 'slideOutRight', kind: 'exit' },
  { name: 'zoomOut', kind: 'exit' },
  { name: 'spin', kind: 'loop' },
  { name: 'float', kind: 'loop' },
  { name: 'pulse', kind: 'loop' },
  { name: 'sway', kind: 'loop' },
] as const satisfies readonly { name: string; kind: PresetKind }[];

export type PresetName = (typeof PRESET_NAMES)[number]['name'];

export const PRESET_NAME_VALUES = PRESET_NAMES.map((preset) => preset.name) as [PresetName, ...PresetName[]];

export const PresetNameSchema = z.enum(PRESET_NAME_VALUES);

export const PRESET_KINDS = Object.fromEntries(PRESET_NAMES.map((preset) => [preset.name, preset.kind])) as Record<PresetName, PresetKind>;

export const FILTER_2D_TYPES = [
  'blur',
  'glow',
  'bloom',
  'dropShadow',
  'adjustment',
  'colorMatrix',
  'noise',
  'rgbSplit',
  'pixelate',
  'crt',
  'oldFilm',
  'zoomBlur',
  'godray',
  'glitch',
  'outline',
] as const;

export type Filter2DType = (typeof FILTER_2D_TYPES)[number];

export const Filter2DTypeSchema = z.enum(FILTER_2D_TYPES);

export const POSTFX_TYPES = ['bloom', 'vignette', 'chromaticAberration', 'noise', 'dof', 'brightnessContrast', 'hueSaturation'] as const;

export type PostFxType = (typeof POSTFX_TYPES)[number];

export const PostFxTypeSchema = z.enum(POSTFX_TYPES);
