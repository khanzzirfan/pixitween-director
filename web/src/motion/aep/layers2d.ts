// AEP shape/image layers -> MotionDoc shape/image layers. See engine/docs/10-aep-adapter.md
// ("Layers") for the conversion rules this implements.
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

export function convertShape(layer: AepShapeLayer, fps: number, theme?: AepThemeMap): ConvertShapeResult {
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
    effects: [],
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
