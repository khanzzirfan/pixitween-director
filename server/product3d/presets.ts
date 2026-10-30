// Owned by S13a. The defaults for a 3D product shot (design section 5.5): what it does when nobody asked for anything else.
import type { LightPreset } from './types';

/** Degrees the product turns either side of the front by default, and the most a chat edit may ask for. */
export const SWAY_DEFAULT = 18;
export const SWAY_MAX = 35;
/** A small downward tilt that shows the top rim, which makes the product read as 3D at once. */
export const TILT_DEG = 4;
export const DEFAULT_PRESET: LightPreset = 'studio';
/** The turn eases in and out. */
export const EASE_IN_OUT: [number, number, number, number] = [0.42, 0, 0.58, 1];
export const MATERIAL = { roughness: 0.35, metalness: 0.55 } as const;
export const SHADOW = { opacity: 0.35, softness: 0.6 } as const;
/** A long lens (little distortion) and 50 % headroom, because the engine clips the shadow at the viewport edge. */
export const CAMERA = { fov: 30, fit: 1.5 } as const;
/**
 * The key light starts high and a little to the left. A low key light throws a shadow far along the plate, and the engine cuts it flat at the viewport edge (seen in the browser on 30 Oct: golden and studio presets at their own angles both did). A high one keeps the shadow under the product.
 */
export const KEY_LIGHT = { azimuth: 20, elevation: 75 } as const;
/** The viewport is rendered at twice the box for crisp edges, and never more than this on the long side. */
export const VIEWPORT_SCALE = 2;
export const VIEWPORT_MAX = 2048;
/** Extrude: depth and bevel as a share of the product's width. */
export const DEPTH_SHARE = 0.06;
export const BEVEL_SHARE = 0.015;

export const clampSway = (deg: number): { value: number; clamped: boolean } => {
  const value = Math.max(-SWAY_MAX, Math.min(SWAY_MAX, deg));
  return { value, clamped: value !== deg };
};
