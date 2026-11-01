// AEP text layer -> MotionDoc text layer. See engine/docs/10-aep-adapter.md
// ("Layers") for the conversion rules this implements.
import type { AepLayer } from '@shared/aep/layer';
import type { AepEffect } from '@shared/aep/effect';
import type { AepAnimatable } from '@shared/aep/transform';
import type { AepRotationUnit } from '@shared/aep/rotation';
import { resolveThemedColorValue, type AepThemeMap } from '@shared/aep/theme';
import type { TextLayer, TextStyle } from '@engine/schema';
import { isKeyframed, type ConvertedTween } from './keyframes';
import { mapBaseLayer } from './baseLayer';
import { convertEffects, dropShadowParams, stageScale } from './effects';
import { sanitizeId } from './sanitizeId';

type AepTextLayer = Extract<AepLayer, { kind: 'text' }>;

export interface ConvertTextResult {
  layer: TextLayer;
  warnings: string[];
}

const SUPPORTED_ALIGN: readonly TextStyle['align'][] = ['left', 'center', 'right'];
const SUPPORTED_FONT_WEIGHTS: readonly TextStyle['fontWeight'][] = [
  '100', '200', '300', '400', '500', '600', '700', '800', '900', 'normal', 'bold',
];

/** MotionDoc text fields are static — a keyframed AEP value takes its first keyframe. */
function firstValue<T>(value: AepAnimatable<T>): T {
  return isKeyframed(value) ? value[0].v : value;
}

function mapAlign(align: string | undefined, id: string, warnings: string[]): TextStyle['align'] {
  if (align === undefined) return 'left';
  if ((SUPPORTED_ALIGN as readonly string[]).includes(align)) return align as TextStyle['align'];
  warnings.push(`layer ${id}: unsupported align '${align}'`);
  return 'left';
}

function mapFontWeight(weight: number | string | undefined, id: string, warnings: string[]): TextStyle['fontWeight'] {
  if (weight === undefined) return '400';
  const str = String(weight);
  if ((SUPPORTED_FONT_WEIGHTS as readonly string[]).includes(str)) return str as TextStyle['fontWeight'];
  warnings.push(`layer ${id}: unsupported weight '${str}'`);
  return '400';
}

/**
 * The engine draws a text layer's shadow into the text's own canvas (`style.dropShadow`), so it stays
 * glued to the glyphs and follows the text's measured size; the layer-effect path would freeze an
 * isolation target at build time. The shadow's params are the shared ones, so it falls the way the
 * AEP says it does.
 */
function convertDropShadow(
  effect: AepEffect,
  layerId: string,
  compSize: { width: number; height: number } | undefined,
  warnings: string[],
): NonNullable<TextStyle['dropShadow']> {
  const shadow = dropShadowParams(effect, stageScale(compSize), layerId, warnings);
  return {
    color: shadow.color,
    alpha: Math.min(1, Math.max(0, shadow.alpha)),
    // The text style's own bounds (engine/src/schema/layers2d.ts).
    blur: Math.min(64, Math.max(0, shadow.blur)),
    distance: Math.min(256, Math.max(0, shadow.distance)),
    angle: shadow.angle,
  };
}

function convertStyle(
  layer: AepTextLayer,
  theme: AepThemeMap | undefined,
  warnings: string[],
  compSize: { width: number; height: number } | undefined,
): TextStyle {
  const { style, effects } = layer;

  const dropShadowEffect = effects?.find((effect) => effect.name === 'drop-shadow');

  const result: TextStyle = {
    fontFamily: style.font,
    fontSize: firstValue(style.size),
    fontWeight: mapFontWeight(style.weight, layer.id, warnings),
    fontStyle: style.italic ? 'italic' : 'normal',
    fill: style.fill === undefined ? '#ffffff' : resolveThemedColorValue(firstValue(style.fill), theme),
    align: mapAlign(style.align, layer.id, warnings),
    wordWrapWidth: style.boxWidth,
    lineHeight: style.lineHeight === undefined ? undefined : firstValue(style.lineHeight),
    letterSpacing: style.letterSpacing === undefined ? 0 : firstValue(style.letterSpacing),
    stroke: style.stroke
      ? { color: firstValue(style.stroke.color), width: firstValue(style.stroke.width) }
      : undefined,
    dropShadow:
      dropShadowEffect === undefined
        ? undefined
        : convertDropShadow(dropShadowEffect, layer.id, compSize, warnings),
  };

  return result;
}

/** `ConvertedTween` omits the engine `Tween`'s `repeat`/`yoyo`, which always default to off here. */
function toEngineTweens(tweens: ConvertedTween[]): TextLayer['tweens'] {
  return tweens.map((tween) => ({ ...tween, repeat: 0, yoyo: false }));
}

/**
 * A text layer has no intrinsic size of its own, so the reacthub-pixitweenjs player read its anchor
 * against the composition: anchor / comp size is the fraction of the text's own box that sits on
 * the position. The usual [W/2, H/2] therefore centres the text on its position.
 */
function textAnchor(layer: AepTextLayer, compSize: { width: number; height: number } | undefined): [number, number] {
  if (!compSize || !(compSize.width > 0) || !(compSize.height > 0)) return [0.5, 0.5];
  const [ax, ay] = firstValue(layer.transform.anchor) as number[];
  return [ax / compSize.width, ay / compSize.height];
}

export function convertText(
  layer: AepTextLayer,
  fps: number,
  theme?: AepThemeMap,
  compSize?: { width: number; height: number },
  rotationUnit?: AepRotationUnit,
): ConvertTextResult {
  const { base, tweens, warnings } = mapBaseLayer(layer, fps, rotationUnit);
  if (isKeyframed(layer.transform.anchor)) warnings.push(`layer ${layer.id}: animated anchor is not supported yet; using the first value`);

  // The text's own shadow goes into the style (the engine draws it into the text canvas); every other
  // effect of a text layer goes through the shared path like it does on any other layer.
  const otherEffects = layer.effects?.filter((effect) => effect.name !== 'drop-shadow');

  const textLayer: TextLayer = {
    ...base,
    // The fractional anchor below places the text; a pixel pivot would override it.
    pivot: undefined,
    id: sanitizeId(layer.id),
    anchor: textAnchor(layer, compSize),
    effects: convertEffects(layer.id, otherEffects, compSize, warnings),
    tweens: toEngineTweens(tweens),
    type: 'text',
    text: firstValue(layer.source),
    style: convertStyle(layer, theme, warnings, compSize),
  };

  return { layer: textLayer, warnings };
}
