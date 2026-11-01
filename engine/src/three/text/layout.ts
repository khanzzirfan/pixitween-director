import type { TypefaceMetrics } from './typeface';

export interface TextLayoutOptions {
  size: number;
  align: 'left' | 'center' | 'right';
  /** Multiplied by `size`. */
  lineHeight: number;
  /** World units added after each glyph advance. */
  letterSpacing: number;
}

export interface LayoutGlyph {
  char: string;
  /** Index of the character in the text (by code point, `\n` included). */
  index: number;
  lineIndex: number;
  wordIndex: number;
  /** Centre of the glyph's advance box. */
  x: number;
  /** Line centre; y decreases for later lines. */
  y: number;
  advance: number;
}

export interface LayoutWord {
  index: number;
  lineIndex: number;
  glyphs: number[];
  /** Horizontal extent of the word's glyph advance boxes. */
  left: number;
  right: number;
  x: number;
  y: number;
}

export interface LayoutLine {
  index: number;
  words: number[];
  glyphs: number[];
  left: number;
  right: number;
  width: number;
  x: number;
  y: number;
}

export interface LayoutBounds {
  width: number;
  height: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface TextLayout {
  glyphs: LayoutGlyph[];
  words: LayoutWord[];
  lines: LayoutLine[];
  bounds: LayoutBounds;
  /** Non-whitespace characters missing from the font: no glyph, no advance. */
  skipped: { char: string; index: number }[];
}

const isSpace = (ch: string) => /\s/u.test(ch);

function splitLines(text: string): string[][] {
  return text.replace(/\r\n?/g, '\n').split('\n').map((l) => Array.from(l));
}

/** Unit counts without metrics: glyphs = non-whitespace chars, words = non-whitespace runs per line, lines = lines. */
export function countUnits(text: string): { glyphs: number; words: number; lines: number } {
  const lines = splitLines(text);
  let glyphs = 0;
  let words = 0;
  for (const chars of lines) {
    let inWord = false;
    for (const ch of chars) {
      if (isSpace(ch)) {
        inWord = false;
      } else {
        glyphs += 1;
        if (!inWord) words += 1;
        inWord = true;
      }
    }
  }
  return { glyphs, words, lines: lines.length };
}

/** Deterministic layout from advance widths. The block is centred on the origin. No kerning, no wrap. */
export function layoutText3D(text: string, metrics: TypefaceMetrics, opts: TextLayoutOptions): TextLayout {
  const { size, align, lineHeight, letterSpacing } = opts;
  const rows = splitLines(text);
  const step = lineHeight * size;
  const lineCount = rows.length;

  interface Pending {
    char: string;
    index: number;
    pen: number;
    advance: number;
    space: boolean;
  }
  const skipped: TextLayout['skipped'] = [];
  const pendingLines: { items: Pending[]; width: number }[] = [];
  let charIndex = 0;
  for (const chars of rows) {
    const items: Pending[] = [];
    let pen = 0;
    for (const ch of chars) {
      const index = charIndex++;
      const space = isSpace(ch);
      if (!space && !metrics.has(ch)) {
        skipped.push({ char: ch, index });
        continue;
      }
      const advance = metrics.advance(space ? ' ' : ch, size);
      items.push({ char: ch, index, pen, advance, space });
      pen += advance + letterSpacing;
    }
    charIndex += 1; // the newline
    const width = items.length ? pen - letterSpacing : 0;
    pendingLines.push({ items, width });
  }

  const blockWidth = Math.max(0, ...pendingLines.map((l) => l.width));
  const glyphs: LayoutGlyph[] = [];
  const words: LayoutWord[] = [];
  const lines: LayoutLine[] = [];

  pendingLines.forEach((pl, lineIndex) => {
    const y = ((lineCount - 1) / 2 - lineIndex) * step;
    const start = align === 'left' ? -blockWidth / 2 : align === 'right' ? blockWidth / 2 - pl.width : -pl.width / 2;
    const line: LayoutLine = {
      index: lineIndex,
      words: [],
      glyphs: [],
      left: start,
      right: start + pl.width,
      width: pl.width,
      x: start + pl.width / 2,
      y,
    };
    let word: LayoutWord | null = null;
    for (const item of pl.items) {
      if (item.space) {
        word = null;
        continue;
      }
      const x = start + item.pen + item.advance / 2;
      if (!word) {
        word = { index: words.length, lineIndex, glyphs: [], left: x - item.advance / 2, right: x + item.advance / 2, x: 0, y };
        words.push(word);
        line.words.push(word.index);
      }
      const glyph: LayoutGlyph = { char: item.char, index: item.index, lineIndex, wordIndex: word.index, x, y, advance: item.advance };
      word.glyphs.push(glyphs.length);
      line.glyphs.push(glyphs.length);
      word.right = x + item.advance / 2;
      word.x = (word.left + word.right) / 2;
      glyphs.push(glyph);
    }
    lines.push(line);
  });

  const height = lineCount * step;
  return {
    glyphs,
    words,
    lines,
    bounds: { width: blockWidth, height, left: -blockWidth / 2, right: blockWidth / 2, top: height / 2, bottom: -height / 2 },
    skipped,
  };
}
