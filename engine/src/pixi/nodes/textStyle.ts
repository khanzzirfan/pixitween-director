import type { TextStyleFontWeight, TextStyleOptions } from 'pixi.js';

/**
 * The subset of the schema's text style that `textStyleFrom` reads. Every field is optional so a
 * partial style (and the schema's own input type) can be mapped; defaults live here.
 */
export interface TextStyleInput {
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: string;
  fontStyle?: 'normal' | 'italic';
  fill?: string;
  align?: 'left' | 'center' | 'right';
  wordWrapWidth?: number;
  lineHeight?: number;
  letterSpacing?: number;
  stroke?: { color: string; width: number };
  dropShadow?: {
    color: string;
    alpha?: number;
    blur?: number;
    distance?: number;
    angle?: number;
  };
}

const DEFAULT_FONT_FAMILY = 'Inter, Helvetica, Arial, sans-serif';
const DEG_TO_RAD = Math.PI / 180;

/**
 * Map a schema text style to Pixi v8 `TextStyleOptions`. v8 expects the object forms
 * (`stroke: { color, width }`, `dropShadow: { color, alpha, blur, distance, angle }`), so this emits
 * them directly. `wordWrap` is turned on exactly when `wordWrapWidth` is set, and the drop shadow's
 * `angle` is converted from degrees to radians.
 */
export function textStyleFrom(style: TextStyleInput): TextStyleOptions {
  const options: TextStyleOptions = {
    fontFamily: style.fontFamily ?? DEFAULT_FONT_FAMILY,
    fontSize: style.fontSize ?? 64,
    fontWeight: (style.fontWeight ?? '400') as TextStyleFontWeight,
    fontStyle: style.fontStyle ?? 'normal',
    fill: style.fill ?? '#ffffff',
    align: style.align ?? 'left',
    letterSpacing: style.letterSpacing ?? 0,
  };

  if (style.lineHeight !== undefined) {
    options.lineHeight = style.lineHeight;
  }

  if (style.wordWrapWidth !== undefined) {
    options.wordWrap = true;
    options.wordWrapWidth = style.wordWrapWidth;
  }

  if (style.stroke) {
    options.stroke = { color: style.stroke.color, width: style.stroke.width };
  }

  if (style.dropShadow) {
    const shadow = style.dropShadow;
    options.dropShadow = {
      color: shadow.color,
      alpha: shadow.alpha ?? 0.5,
      blur: shadow.blur ?? 4,
      distance: shadow.distance ?? 4,
      angle: (shadow.angle ?? 45) * DEG_TO_RAD,
    };
  }

  return options;
}
