import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { countUnits, layoutText3D } from './layout';
import { parseTypeface } from './typeface';

const metrics = parseTypeface(JSON.parse(readFileSync(resolve(process.cwd(), 'web/public/fonts/helvetiker_bold.typeface.json'), 'utf8')));
const opts = { size: 1, align: 'center', lineHeight: 1.2, letterSpacing: 0 } as const;

describe('typeface', () => {
  it('advance scales with size', () => {
    expect(metrics.advance('H', 1)).toBeCloseTo(0.953, 9);
    expect(metrics.advance('H', 2)).toBeCloseTo(1.906, 9);
    expect(metrics.has('H')).toBe(true);
    expect(metrics.has('中')).toBe(false);
  });
  it('falls back for space when the font has none', () => {
    expect(parseTypeface({ resolution: 1000, glyphs: {} }).advance(' ', 2)).toBeCloseTo(0.6, 9);
  });
});

describe('layoutText3D', () => {
  it('centres the block', () => {
    const l = layoutText3D('Hi', metrics, opts);
    const total = metrics.advance('H', 1) + metrics.advance('i', 1);
    expect(l.bounds.width).toBeCloseTo(total, 9);
    const [h, i] = l.glyphs;
    expect((h.x - h.advance / 2 + i.x + i.advance / 2) / 2).toBeCloseTo(0, 9);
    expect(i.x + i.advance / 2 - (h.x - h.advance / 2)).toBeCloseTo(total, 9);
  });
  it('counts lines, words, glyphs', () => {
    const l = layoutText3D('ab\ncd e', metrics, opts);
    expect([l.lines.length, l.words.length, l.glyphs.length]).toEqual([2, 3, 5]);
    expect(countUnits('ab\ncd e')).toEqual({ glyphs: 5, words: 3, lines: 2 });
    expect(l.lines[0].y - l.lines[1].y).toBeCloseTo(1.2, 9);
    expect(l.glyphs[0].y).toBeGreaterThan(l.glyphs[4].y);
    expect(l.glyphs.map((g) => g.wordIndex)).toEqual([0, 0, 1, 1, 2]);
  });
  it('counts blank lines', () => {
    expect(countUnits('a\n\nb').lines).toBe(3);
  });
  it('aligns left and right', () => {
    const left = layoutText3D('Hello\nHi', metrics, { ...opts, align: 'left' });
    expect(left.lines[0].left).toBeCloseTo(left.lines[1].left, 9);
    const right = layoutText3D('Hello\nHi', metrics, { ...opts, align: 'right' });
    expect(right.lines[0].right).toBeCloseTo(right.lines[1].right, 9);
  });
  it('skips characters missing from the font', () => {
    const l = layoutText3D('a中b', metrics, opts);
    expect(l.skipped).toEqual([{ char: '中', index: 1 }]);
    expect(l.glyphs.map((g) => g.char)).toEqual(['a', 'b']);
  });
  it('letterSpacing widens lines', () => {
    const a = layoutText3D('Hi', metrics, opts).bounds.width;
    expect(layoutText3D('Hi', metrics, { ...opts, letterSpacing: 0.1 }).bounds.width).toBeCloseTo(a + 0.1, 9);
  });
  it('is deterministic', () => {
    expect(layoutText3D('ab\ncd e', metrics, opts)).toEqual(layoutText3D('ab\ncd e', metrics, opts));
  });
});
