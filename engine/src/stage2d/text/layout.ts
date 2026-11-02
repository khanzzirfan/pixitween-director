import type { TextStyle } from '../../schema/layers2d';

export interface Measure {
  (text: string, font: string, letterSpacing: number): number;
}

export interface TextLine {
  text: string;
  width: number;
  x: number;
  y: number;
}

export interface TextLayout {
  lines: TextLine[];
  width: number;
  height: number;
}

type FontStyle = Pick<TextStyle, 'fontWeight' | 'fontSize' | 'fontStyle' | 'fontFamily'>;

export function cssFont(style: FontStyle): string {
  const italic = style.fontStyle === 'italic' ? 'italic ' : '';
  return `${italic}${style.fontWeight} ${style.fontSize}px ${style.fontFamily}`;
}

function wrapParagraph(paragraph: string, wordWrapWidth: number, font: string, letterSpacing: number, measure: Measure): string[] {
  const lines: string[] = [];
  let current = '';
  for (const word of paragraph.split(' ')) {
    const candidate = current === '' ? word : `${current} ${word}`;
    if (current !== '' && measure(candidate, font, letterSpacing) > wordWrapWidth) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  lines.push(current);
  return lines;
}

export function layoutTextLines(text: string, style: TextStyle, measure: Measure): TextLayout {
  const font = cssFont(style);
  const letterSpacing = style.letterSpacing;
  const lineHeight = style.lineHeight ?? style.fontSize * 1.2;
  const rawLines = text
    .split('\n')
    .flatMap((paragraph) =>
      style.wordWrapWidth === undefined ? [paragraph] : wrapParagraph(paragraph, style.wordWrapWidth, font, letterSpacing, measure),
    );

  const widths = rawLines.map((line) => measure(line, font, letterSpacing));
  const maxWidth = Math.max(0, ...widths);

  const lines: TextLine[] = rawLines.map((line, i) => {
    const width = widths[i];
    const x = style.align === 'center' ? (maxWidth - width) / 2 : style.align === 'right' ? maxWidth - width : 0;
    // Baseline: glyphs centred in the line box (cap/x-height ≈ 0.7 em), so descenders stay inside it.
    const y = i * lineHeight + (lineHeight + style.fontSize * 0.7) / 2;
    return { text: line, width, x, y };
  });

  return { lines, width: maxWidth, height: rawLines.length * lineHeight };
}

export function textPadding(style: Pick<TextStyle, 'stroke' | 'dropShadow'>): number {
  const strokeWidth = style.stroke?.width ?? 0;
  const shadowReach = style.dropShadow ? style.dropShadow.blur + style.dropShadow.distance : 0;
  return Math.max(strokeWidth, shadowReach);
}
