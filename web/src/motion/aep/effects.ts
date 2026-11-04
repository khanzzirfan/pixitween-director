// AEP layer effects -> MotionDoc layer effects. One place holds the mapping (engine/docs/10-aep-adapter.md,
// "Effects"): every layer kind goes through it, so an effect is either mapped or named in a warning.
import type { AepEffect } from '@shared/aep/effect';
import type { EffectSpec } from '@engine/schema';

/** The reacthub-pixitweenjs player drew every composition on a stage whose longest side was this many pixels. */
export const PLAYER_STAGE_LONGEST_SIDE = 960;

/**
 * The scale from the player's 960 px stage to the composition's own pixels. An effect the player measured
 * in stage pixels (a blur strength, a shadow distance) covers the same share of the frame once it is
 * scaled by it.
 */
export function stageScale(compSize: { width: number; height: number } | undefined): number {
  return compSize ? Math.max(compSize.width, compSize.height) / PLAYER_STAGE_LONGEST_SIDE : 1;
}

/**
 * The AEP `direction` is the compass direction a shadow falls, counted clockwise from up (0 = up,
 * 90 = right, 180 = down); the engine's `angle` is the same vector counted clockwise from the right
 * (0 = right, 90 = down, `engine/src/effects/custom/dropShadow.ts`). The two differ by a quarter turn:
 * 180 (straight down) becomes 90, and the upstream default 135 (down-right) becomes the engine's own
 * default 45.
 */
export function engineAngle(direction: number): number {
  return direction - 90;
}

/** The engine's drop-shadow params (the effect and the text style take the same five). */
export interface DropShadowParams {
  color: string;
  alpha: number;
  distance: number;
  angle: number;
  blur: number;
}

interface ReadParam {
  value: number | string | boolean;
  animated: boolean;
}

/** The first value of a param; a keyframed param is not animated in the engine yet. */
function readParam(params: AepEffect['params'], key: string): ReadParam | undefined {
  const raw = params[key] as unknown;
  if (raw === undefined) return undefined;
  if (Array.isArray(raw)) {
    const first = raw[0] as { v?: unknown } | undefined;
    const value = first?.v;
    return {
      value: typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean' ? value : 0,
      animated: true,
    };
  }
  if (typeof raw === 'number' || typeof raw === 'string' || typeof raw === 'boolean') {
    return { value: raw, animated: false };
  }
  return undefined;
}

/** The effect's params, read by name. A keyframed param keeps its first value and says so. */
function readParams(effect: AepEffect, layerId: string, warnings: string[]) {
  const read = (key: string): ReadParam | undefined => readParam(effect.params, key);
  const warnAnimated = (key: string): void => {
    warnings.push(`layer ${layerId}: animated ${effect.name} ${key} is not supported yet; using the first value`);
  };
  return {
    num(key: string, fallback: number): number {
      const param = read(key);
      if (param === undefined) return fallback;
      if (param.animated) warnAnimated(key);
      return typeof param.value === 'number' ? param.value : fallback;
    },
    color(key: string, fallback: string): string {
      const param = read(key);
      if (param === undefined) return fallback;
      if (param.animated) warnAnimated(key);
      return typeof param.value === 'string' ? param.value : fallback;
    },
    bool(key: string, fallback: boolean): boolean {
      const param = read(key);
      if (param === undefined) return fallback;
      if (param.animated) warnAnimated(key);
      return typeof param.value === 'boolean' ? param.value : fallback;
    },
  };
}

/**
 * The AEP `drop-shadow` -> the engine's drop shadow. `distance` is a length the player measured on its
 * 960 px stage, so it is scaled to the composition; `softness` is the blur radius and is taken as written.
 */
export function dropShadowParams(
  effect: AepEffect,
  scale: number,
  layerId: string,
  warnings: string[],
): DropShadowParams {
  const params = readParams(effect, layerId, warnings);
  return {
    color: params.color('color', '#000000'),
    alpha: params.num('opacity', 0.5),
    distance: params.num('distance', 4) * scale,
    angle: engineAngle(params.num('direction', 135)),
    blur: params.num('softness', 4),
  };
}

/**
 * Every AEP effect on a layer -> the engine's layer effects. An effect the engine has no counterpart for
 * is dropped with one warning naming the layer, so nothing disappears quietly.
 */
export function convertEffects(
  layerId: string,
  effects: AepEffect[] | undefined,
  compSize: { width: number; height: number } | undefined,
  warnings: string[],
): EffectSpec[] {
  const scale = stageScale(compSize);
  const out: EffectSpec[] = [];
  (effects ?? []).forEach((effect, index) => {
    const id = `fx${index}`;
    const enabled = effect.enabled !== false;
    const params = readParams(effect, layerId, warnings);
    switch (effect.name) {
      case 'drop-shadow': {
        const shadow = dropShadowParams(effect, scale, layerId, warnings);
        out.push({
          id,
          type: 'dropShadow',
          enabled,
          params: {
            color: shadow.color,
            alpha: shadow.alpha,
            distance: shadow.distance,
            angle: shadow.angle,
            blur: shadow.blur,
          },
        });
        break;
      }
      case 'gaussian-blur': {
        // The player's pixi BlurFilter took its strength in stage pixels: the engine's gaussianBlur is the
        // same filter, so the strength is scaled to the composition.
        out.push({
          id,
          type: 'gaussianBlur',
          enabled,
          params: { strength: Math.max(0, params.num('blurriness', 0) * scale) },
        });
        break;
      }
      case 'glow': {
        const inner = params.num('inner-intensity', 0);
        if (inner !== 0) {
          warnings.push(`layer ${layerId}: glow inner-intensity is not supported yet; using an outer glow`);
        }
        out.push({
          id,
          type: 'glow',
          enabled,
          params: {
            color: params.color('color', '#ffffff'),
            // The engine's glow is an outer glow: its strength is the AEP intensity, dimmed by the opacity.
            strength: Math.max(0, params.num('intensity', 4) * params.num('opacity', 1)),
            distance: Math.max(0, params.num('radius', 10) * scale),
          },
        });
        break;
      }
      case 'brightness-contrast': {
        out.push({
          id,
          type: 'brightnessContrast',
          enabled,
          params: {
            brightness: clamp(params.num('brightness', 0), -1, 1),
            contrast: clamp(params.num('contrast', 0), 0, 1),
          },
        });
        break;
      }
      case 'hue-saturation': {
        const lightness = params.num('master-lightness', 0);
        const colorize = params.bool('colorize', false);
        if (lightness !== 0 || colorize) {
          warnings.push(
            `layer ${layerId}: hue-saturation master-lightness and colorize are not supported yet; using hue and saturation only`,
          );
        }
        out.push({
          id,
          type: 'hueSaturation',
          enabled,
          params: {
            hue: params.num('master-hue', 0),
            // The AEP writes the saturation as a percentage; the engine takes it as a factor.
            saturation: clamp(params.num('master-saturation', 0) / 100, -1, 1),
          },
        });
        break;
      }
      default:
        warnings.push(`layer ${layerId}: unsupported effect '${effect.name}'`);
    }
  });
  return out;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
