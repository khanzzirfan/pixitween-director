// AEP shape/image layers -> MotionDoc shape/image layers. See engine/docs/10-aep-adapter.md
// ("Layers") for the conversion rules this implements.
import type { AepEffect } from '@shared/aep/effect';
import type { AepLayer } from '@shared/aep/layer';
import type { AepAnimatable } from '@shared/aep/transform';
import { resolveThemedColorValue, type AepThemableColor, type AepThemeMap } from '@shared/aep/theme';
import type { ImageLayer, ShapeLayer } from '@engine/schema';
import { isKeyframed, type ConvertedTween } from './keyframes';
import { mapBaseLayer } from './baseLayer';
import { sanitizeId } from './sanitizeId';

/** `ConvertedTween` omits the engine `Tween`'s `repeat`/`yoyo`, which always default to off here. */
function toEngineTweens(tweens: ConvertedTween[]): ImageLayer['tweens'] {
  return tweens.map((tween) => ({ ...tween, repeat: 0, yoyo: false }));
}

type AepShapeLayer = Extract<AepLayer, { kind: 'shape' }>;
type AepImageLayer = Extract<AepLayer, { kind: 'image' }>;

export interface ConvertShapeResult {
  layer: ShapeLayer;
  warnings: string[];
}

export interface ConvertImageResult {
  layer: ImageLayer;
  warnings: string[];
}

/** MotionDoc shape/image fields are static — a keyframed AEP value takes its first keyframe. */
function firstValue<T>(value: AepAnimatable<T>): T {
  return isKeyframed(value) ? value[0].v : value;
}

function staticThemableColor(value: AepThemableColor | undefined, theme: AepThemeMap | undefined, fallback: string): string {
  if (value === undefined) return fallback;
  return resolveThemedColorValue(firstValue(value), theme);
}

export function convertShape(
  layer: AepShapeLayer,
  fps: number,
  theme?: AepThemeMap,
  compSize?: { width: number; height: number },
): ConvertShapeResult {
  const { base, tweens, warnings } = mapBaseLayer(layer, fps);
  const { path } = layer;

  let shape: 'rect' | 'ellipse' = 'rect';
  let width = 1;
  let height = 1;
  let radius = 0;

  if (path.kind === 'rect' || path.kind === 'ellipse') {
    shape = path.kind;
    const [w, h] = firstValue(path.size);
    width = w;
    height = h;
    if (path.kind === 'rect' && path.roundness !== undefined) {
      radius = firstValue(path.roundness);
    }
  } else {
    warnings.push(`layer ${layer.id}: unsupported shape path '${path.kind}'`);
  }

  const shapeLayer: ShapeLayer = {
    ...base,
    id: sanitizeId(layer.id),
    anchor: [0.5, 0.5],
    effects: convertEffects(layer, warnings, compSize),
    tweens: toEngineTweens(tweens),
    type: 'shape',
    shape,
    width,
    height,
    fill: staticThemableColor(layer.fill, theme, '#ffffff'),
    radius,
    stroke: layer.stroke
      ? { color: staticThemableColor(layer.stroke.color, theme, '#000000'), width: firstValue(layer.stroke.width) }
      : undefined,
  };

  return { layer: shapeLayer, warnings };
}

/** The reacthub-pixitweenjs player drew every composition on a stage whose longest side was this many pixels. */
const PLAYER_STAGE_LONGEST_SIDE = 960;

/**
 * AEP effects on a 2D layer. `gaussian-blur` is the player's pixi BlurFilter (blurriness = its
 * strength); the engine's gaussianBlur effect reproduces it. Pixi measured that strength in stage
 * pixels, and the player's stage was the composition scaled to a 960 px longest side, so the blur is
 * scaled by comp size / 960 to cover the same share of the frame. Others are reported and dropped.
 */
function convertEffects(
  layer: { id: string; effects?: AepEffect[] },
  warnings: string[],
  compSize: { width: number; height: number } | undefined,
): ShapeLayer['effects'] {
  const stageScale = compSize ? Math.max(compSize.width, compSize.height) / PLAYER_STAGE_LONGEST_SIDE : 1;
  const out: ShapeLayer['effects'] = [];
  (layer.effects ?? []).forEach((effect, index) => {
    if (effect.name === 'gaussian-blur') {
      const raw = (effect.params as Record<string, unknown> | undefined)?.blurriness;
      const strength = typeof raw === 'number' ? raw : Array.isArray(raw) && raw.length > 0 && typeof raw[0]?.v === 'number' ? raw[0].v : 0;
      if (Array.isArray(raw)) warnings.push(`layer ${layer.id}: animated gaussian-blur blurriness is not supported yet; using the first value`);
      out.push({ id: `fx${index}`, type: 'gaussianBlur', enabled: true, params: { strength: Math.max(0, strength) * stageScale } } as ShapeLayer['effects'][number]);
    } else {
      warnings.push(`layer ${layer.id}: unsupported effect '${effect.name}'`);
    }
  });
  return out;
}

export function convertImage(layer: AepImageLayer, fps: number): ConvertImageResult {
  const { base, tweens, warnings } = mapBaseLayer(layer, fps);

  const imageLayer: ImageLayer = {
    ...base,
    id: sanitizeId(layer.id),
    anchor: [0.5, 0.5],
    effects: [],
    tweens: toEngineTweens(tweens),
    type: 'image',
    asset: sanitizeId(layer.assetId),
    tint: '#ffffff',
  };

  return { layer: imageLayer, warnings };
}
