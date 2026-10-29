import type { LayerRole, Ease } from './types';

export const AEP_VERSION = '1.9.0';
export const MAX_SCENES = 12;
export const MAX_FILM_SECONDS = 60;

export const ROLE_KINDS: Record<LayerRole, string[]> = {
  bg: ['shape', 'image'],
  clip: ['video'],
  subject: ['image'],
  product: ['image'],
  headline: ['text'],
  caption: ['text'],
  camera: [],
};

/** z = distance from the camera; larger is farther. */
export const DEFAULT_Z: Record<string, number> = { bg: 10, clip: 10, subject: 3, product: 1, headline: 0, caption: 0 };

export const EASE_HANDLES: Record<Ease, [number, number, number, number] | undefined> = {
  linear: undefined,
  easeIn: [0.42, 0, 1, 1],
  easeOut: [0, 0, 0.58, 1],
  easeInOut: [0.42, 0, 0.58, 1],
};

/** Fractions of the composition: x, y, w, h. */
export const DEFAULT_BOX_FRACTIONS: Record<string, { x: number; y: number; w: number; h: number }> = {
  bg: { x: 0, y: 0, w: 1, h: 1 },
  clip: { x: 0, y: 0, w: 1, h: 1 },
  product: { x: 0.15, y: 0.21, w: 0.7, h: 0.62 },
  subject: { x: 0.05, y: 0.15, w: 0.4, h: 0.7 },
  headline: { x: 0.1, y: 0.08, w: 0.8, h: 0.16 },
  caption: { x: 0.1, y: 0.84, w: 0.8, h: 0.1 },
};

export const TEXT_DEFAULTS = {
  font: 'Inter, system-ui, sans-serif',
  fill: '#ffffff',
  weight: 700,
  align: 'center',
  headlineSizeFraction: 0.07,
  captionSizeFraction: 0.04,
} as const;

export const CAMERA_FACTORS = { dollyGrowth: 0.15, panTravel: 0.08, parallaxPan: 0.04, parallaxGrowth: 0.06, orbitPan: 0.1, orbitRotationDeg: 1.5 } as const;

/** Heads-up roles are never moved by the camera. */
export const HUD_ROLES = ['headline', 'caption'] as const;

export const depthWeight = (z: number): number => 1 / (1 + 0.5 * Math.max(z, 0));
