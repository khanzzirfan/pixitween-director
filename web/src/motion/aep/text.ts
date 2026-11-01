// AEP text layer -> MotionDoc text layer. See engine/docs/10-aep-adapter.md
// ("Layers") for the conversion rules this implements.
import type { AepLayer } from '@shared/aep/layer';
import type { AepEffect } from '@shared/aep/effect';
import type { AepAnimatable } from '@shared/aep/transform';
import { resolveThemedColorValue, type AepThemeMap } from '@shared/aep/theme';
import type { TextLayer, TextStyle } from '@engine/schema';
import { isKeyframed, type ConvertedTween } from './keyframes';
import { mapBaseLayer } from './baseLayer';
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

function numParam(value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  return firstValue(value as AepAnimatable<number>);
}

function colorParam(value: unknown, fallback: string): string {
  if (value === undefined) return fallback;
  return firstValue(value as AepAnimatable<string>);
}

function convertDropShadow(effect: AepEffect): NonNullable<TextStyle['dropShadow']> {
  const { params } = effect;
  return {
    distance: numParam(params.distance, 4),
    angle: numParam(params.direction, 45),
    blur: numParam(params.softness, 4),
    alpha: numParam(params.opacity, 0.5),
    color: colorParam(params.color, '#000000'),
  };
}

function convertStyle(layer: AepTextLayer, theme: AepThemeMap | undefined, warnings: string[]): TextStyle {
  const { style, effects } = layer;

  const dropShadowEffect = effects?.find((effect) => effect.name === 'drop-shadow');
  const unsupportedEffects = effects?.filter((effect) => effect.name !== 'drop-shadow') ?? [];
  for (const effect of unsupportedEffects) {
    warnings.push(`layer ${layer.id}: unsupported effect '${effect.name}'`);
  }

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
    dropShadow: dropShadowEffect ? convertDropShadow(dropShadowEffect) : undefined,
  };

  return result;
}

/** `ConvertedTween` omits the engine `Tween`'s `repeat`/`yoyo`, which always default to off here. */
function toEngineTweens(tweens: ConvertedTween[]): TextLayer['tweens'] {
  return tweens.map((tween) => ({ ...tween, repeat: 0, yoyo: false }));
}

export function convertText(layer: AepTextLayer, fps: number, theme?: AepThemeMap): ConvertTextResult {
  const { base, tweens, warnings } = mapBaseLayer(layer, fps);

  const textLayer: TextLayer = {
    ...base,
    id: sanitizeId(layer.id),
    anchor: [0.5, 0.5],
    effects: [],
    tweens: toEngineTweens(tweens),
    type: 'text',
    text: firstValue(layer.source),
    style: convertStyle(layer, theme, warnings),
  };

  return { layer: textLayer, warnings };
}
