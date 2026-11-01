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
  { name: 'cameraTo', kind: 'enter' },
  { name: 'crane', kind: 'enter' },
  { name: 'dollyZoom', kind: 'enter' },
  { name: 'orbit', kind: 'loop' },
  { name: 'handheld', kind: 'loop' },
  { name: 'glyphRise', kind: 'enter' },
  { name: 'glyphPop', kind: 'enter' },
  { name: 'glyphFlip', kind: 'enter' },
  { name: 'glyphFadeOut', kind: 'exit' },
  { name: 'glyphWave', kind: 'loop' },
] as const satisfies readonly { name: string; kind: PresetKind }[];

export type PresetName = (typeof PRESET_NAMES)[number]['name'];

export const PRESET_NAME_VALUES = PRESET_NAMES.map((preset) => preset.name) as [PresetName, ...PresetName[]];

export const PresetNameSchema = z.enum(PRESET_NAME_VALUES);

export const PRESET_KINDS = Object.fromEntries(PRESET_NAMES.map((preset) => [preset.name, preset.kind])) as Record<PresetName, PresetKind>;

/** The camera presets: they move the camera of a three layer (engine/docs/09-camera.md). */
export const CAMERA_PRESET_NAMES = ['cameraTo', 'crane', 'dollyZoom', 'orbit', 'handheld'] as const;

export type CameraPresetName = (typeof CAMERA_PRESET_NAMES)[number];

export const CAMERA_PRESET_SET: ReadonlySet<PresetName> = new Set<PresetName>(CAMERA_PRESET_NAMES);

/** The text presets: they animate the units of a text3d object (engine/docs/07-text3d.md). */
export const TEXT_PRESET_NAMES = ['glyphRise', 'glyphPop', 'glyphFlip', 'glyphFadeOut', 'glyphWave'] as const;

export type TextPresetName = (typeof TEXT_PRESET_NAMES)[number];

export const TEXT_PRESET_SET: ReadonlySet<PresetName> = new Set<PresetName>(TEXT_PRESET_NAMES);

export type EffectScope = 'any' | 'three' | '2d';

/** Every effect type and where it may be used (engine/docs/05-effects.md, "Effect types"). */
export const EFFECT_SCOPES = {
  bloom: 'any',
  vignette: 'any',
  chromaticAberration: 'any',
  noise: 'any',
  brightnessContrast: 'any',
  hueSaturation: 'any',
  sepia: 'any',
  grayscale: 'any',
  pixelate: 'any',
  scanlines: 'any',
  dotScreen: 'any',
  tiltShift: 'any',
  blur: 'any',
  glow: '2d',
  dropShadow: '2d',
  outline: '2d',
  dof: 'three',
} as const satisfies Record<string, EffectScope>;

export type EffectType = keyof typeof EFFECT_SCOPES;

export const EFFECT_TYPES = Object.keys(EFFECT_SCOPES) as [EffectType, ...EffectType[]];

export const EffectTypeSchema = z.enum(EFFECT_TYPES);
