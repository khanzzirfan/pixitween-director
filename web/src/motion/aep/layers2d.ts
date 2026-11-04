// AEP shape/image layers -> MotionDoc shape/image layers. See engine/docs/10-aep-adapter.md
// ("Layers") for the conversion rules this implements.
import type { AepLayer } from '@shared/aep/layer';
import type { AepAnimatable } from '@shared/aep/transform';
import type { AepRotationUnit } from '@shared/aep/rotation';
import { resolveThemedColorValue, type AepThemableColor, type AepThemeMap } from '@shared/aep/theme';
import type { ImageLayer, ShapeLayer } from '@engine/schema';
import { isKeyframed, type ConvertedTween } from './keyframes';
import { mapBaseLayer } from './baseLayer';
import { convertEffects } from './effects';
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
  rotationUnit?: AepRotationUnit,
): ConvertShapeResult {
  const { base, tweens, warnings } = mapBaseLayer(layer, fps, rotationUnit);
  const { path } = layer;

  let shape: 'rect' | 'ellipse' | 'polystar' = 'rect';
  let width = 1;
  let height = 1;
  let radius = 0;
  let points: number | undefined;
  let outerRadius: number | undefined;
  let innerRadius: number | undefined;
  let starType: 'star' | 'polygon' | undefined;

  if (path.kind === 'rect' || path.kind === 'ellipse') {
    shape = path.kind;
    const [w, h] = firstValue(path.size);
    width = w;
    height = h;
    if (path.kind === 'rect' && path.roundness !== undefined) {
      radius = firstValue(path.roundness);
    }
  } else if (path.kind === 'polystar') {
    // A star or a polygon: the tips and the two radii it is drawn from (engine/docs/10-aep-adapter.md,
    // "Shapes"). Its size is the outer radius twice over.
    shape = 'polystar';
    const rawPoints = firstValue(path.points);
    points = Math.round(rawPoints);
    if (points < 3) {
      warnings.push(`layer ${layer.id}: a polystar needs at least 3 points, got ${rawPoints}`);
      points = 3;
    }
    const rawOuter = firstValue(path.outerRadius);
    outerRadius = rawOuter > 0 ? rawOuter : 1;
    if (rawOuter <= 0) {
      warnings.push(`layer ${layer.id}: a polystar needs a positive outer radius, got ${rawOuter}`);
    }
    if (path.innerRadius !== undefined) {
      const rawInner = firstValue(path.innerRadius);
      innerRadius = Math.max(0, Math.min(rawInner, outerRadius));
      if (innerRadius !== rawInner) {
        warnings.push(`layer ${layer.id}: the polystar's inner radius ${rawInner} does not fit inside its outer radius ${rawOuter}`);
      }
    }
    starType = path.starType;
    if (path.rotation !== undefined) {
      warnings.push(`layer ${layer.id}: the polystar's own rotation is not supported yet`);
    }
    if (path.innerRoundness !== undefined || path.outerRoundness !== undefined) {
      warnings.push(`layer ${layer.id}: the polystar's roundness is not supported yet`);
    }
    width = outerRadius * 2;
    height = outerRadius * 2;
  } else {
    warnings.push(`layer ${layer.id}: unsupported shape path '${path.kind}'`);
  }

  const shapeLayer: ShapeLayer = {
    ...base,
    id: sanitizeId(layer.id),
    anchor: [0.5, 0.5],
    effects: convertEffects(layer.id, layer.effects, compSize, warnings),
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
    ...(shape === 'polystar' ? { points, outerRadius, innerRadius, starType } : {}),
  };

  return { layer: shapeLayer, warnings };
}

export function convertImage(
  layer: AepImageLayer,
  fps: number,
  compSize?: { width: number; height: number },
  rotationUnit?: AepRotationUnit,
): ConvertImageResult {
  const { base, tweens, warnings } = mapBaseLayer(layer, fps, rotationUnit);

  const imageLayer: ImageLayer = {
    ...base,
    id: sanitizeId(layer.id),
    anchor: [0.5, 0.5],
    effects: convertEffects(layer.id, layer.effects, compSize, warnings),
    tweens: toEngineTweens(tweens),
    type: 'image',
    asset: sanitizeId(layer.assetId),
    tint: '#ffffff',
  };

  return { layer: imageLayer, warnings };
}
