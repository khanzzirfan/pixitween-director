// AEP layer → MotionDoc base transform + timing. See engine/docs/10-aep-adapter.md
// ("Time" and "Base transform") for the conversion rules this implements. Per-kind
// converters spread `base` and append their own fields on top.
import type { AepTransform, AepAnimatable } from '@shared/aep/transform';
import { isKeyframed, propertyTweens, type AepPropertyValue, type ConvertedTween } from './keyframes';

export type MotionBlendMode = 'normal' | 'add' | 'multiply' | 'screen';
const SUPPORTED_BLEND_MODES: readonly MotionBlendMode[] = ['normal', 'add', 'multiply', 'screen'];

// Common fields every AEP layer kind carries (`shared/aep/layer.ts`'s `layerBase`).
export interface AepBaseLayer {
  id: string;
  inPoint: number;
  outPoint: number;
  transform: AepTransform;
  blendMode?: string;
}

export interface BaseLayerFields {
  start: number;
  end: number;
  x: number;
  y: number;
  pivot: [number, number];
  scale: number | [number, number];
  rotation: number;
  alpha: number;
  blendMode: MotionBlendMode;
}

export interface BaseLayerResult {
  base: BaseLayerFields;
  tweens: ConvertedTween[];
  warnings: string[];
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/** `['scale']` when x = y for every keyframe (or the constant value); otherwise `['scaleX','scaleY']`. */
function scaleProps(value: AepAnimatable<AepPropertyValue>): string[] {
  const frames = isKeyframed(value) ? value.map((k) => k.v) : [value];
  const uniform = frames.every((v) => Array.isArray(v) && v[0] === v[1]);
  return uniform ? ['scale'] : ['scaleX', 'scaleY'];
}

function anchorToPivot(value: AepAnimatable<AepPropertyValue>): [number, number] {
  const v = isKeyframed(value) ? value[0].v : value;
  const [ax, ay] = v as number[];
  return [ax, ay];
}

export function mapBaseLayer(layer: AepBaseLayer, fps: number): BaseLayerResult {
  const { id, inPoint, outPoint, transform, blendMode } = layer;
  const warnings: string[] = [];
  const tweens: ConvertedTween[] = [];

  const position = propertyTweens(transform.position, { fps, inPoint, props: ['x', 'y'] });
  tweens.push(...position.tweens);

  const scale = propertyTweens(transform.scale, { fps, inPoint, props: scaleProps(transform.scale) });
  tweens.push(...scale.tweens);

  const rotation = propertyTweens(transform.rotation, { fps, inPoint, props: ['rotation'] });
  tweens.push(...rotation.tweens);

  const opacity = propertyTweens(transform.opacity, { fps, inPoint, props: ['alpha'] });
  tweens.push(...opacity.tweens);

  const resolvedBlendMode = blendMode ?? 'normal';
  const isSupported = (SUPPORTED_BLEND_MODES as readonly string[]).includes(resolvedBlendMode);
  if (!isSupported) {
    warnings.push(`layer ${id}: unsupported blendMode '${resolvedBlendMode}'`);
  }

  const scaleValue: number | [number, number] =
    'scale' in scale.initial ? scale.initial.scale : [scale.initial.scaleX, scale.initial.scaleY];

  const base: BaseLayerFields = {
    start: round(inPoint / fps),
    end: round(outPoint / fps),
    x: position.initial.x,
    y: position.initial.y,
    pivot: anchorToPivot(transform.anchor),
    scale: scaleValue,
    rotation: rotation.initial.rotation,
    alpha: opacity.initial.alpha,
    blendMode: isSupported ? (resolvedBlendMode as MotionBlendMode) : 'normal',
  };

  return { base, tweens, warnings };
}
