import { describe, expect, it } from 'vitest';
import { TextStyleSchema } from '../../schema/layers2d';
import { cssFont, layoutTextLines, textPadding, type Measure } from './layout';

const charMeasure: Measure = (text) => text.length * 10;

describe('cssFont', () => {
  it('builds a CSS font string from weight, size and family', () => {
    expect(cssFont({ fontWeight: '700', fontSize: 96, fontStyle: 'normal', fontFamily: 'Inter, sans-serif' })).toBe(
      '700 96px Inter, sans-serif',
    );
  });

  it('prefixes italic styles with "italic "', () => {
    expect(cssFont({ fontWeight: '700', fontSize: 96, fontStyle: 'italic', fontFamily: 'Inter, sans-serif' })).toBe(
      'italic 700 96px Inter, sans-serif',
    );
  });
});

describe('layoutTextLines', () => {
  it('wraps on spaces at wordWrapWidth', () => {
    const style = TextStyleSchema.parse({ wordWrapWidth: 75 });
    const layout = layoutTextLines('aaa bbb ccc', style, charMeasure);
    expect(layout.lines.map((line) => line.text)).toEqual(['aaa bbb', 'ccc']);
  });

  it('keeps a single line of full width when wordWrapWidth is unset', () => {
    const style = TextStyleSchema.parse({});
    const layout = layoutTextLines('aaa bbb ccc', style, charMeasure);
    expect(layout.lines).toHaveLength(1);
    expect(layout.width).toBe(110);
  });

  it('centers lines within the widest line', () => {
    const style = TextStyleSchema.parse({ wordWrapWidth: 75, align: 'center' });
    const layout = layoutTextLines('aaa bbb ccc', style, charMeasure);
    expect(layout.lines[0].width).toBe(70);
    expect(layout.lines[1].width).toBe(30);
    expect(layout.lines[1].x).toBe(20);
  });

  it('right-aligns lines within the widest line', () => {
    const style = TextStyleSchema.parse({ wordWrapWidth: 75, align: 'right' });
    const layout = layoutTextLines('aaa bbb ccc', style, charMeasure);
    expect(layout.lines[1].x).toBe(40);
  });

  it('is pure: identical input gives deep-equal output', () => {
    const style = TextStyleSchema.parse({ wordWrapWidth: 75, align: 'center' });
    expect(layoutTextLines('aaa bbb ccc', style, charMeasure)).toEqual(layoutTextLines('aaa bbb ccc', style, charMeasure));
  });
});

describe('textPadding', () => {
  it('is the max of stroke width and shadow blur + distance', () => {
    const style = TextStyleSchema.parse({ stroke: { color: '#000000', width: 4 }, dropShadow: { color: '#000000', blur: 6, distance: 5 } });
    expect(textPadding(style)).toBe(11);
  });
});

describe('layoutTextLines baseline', () => {
  it('keeps the descender inside the line box', () => {
    const style = { fontFamily: 'Inter', fontSize: 100, fontWeight: '400', fontStyle: 'normal', fill: '#ffffff', align: 'left', letterSpacing: 0 } as const;
    const layout = layoutTextLines('gy\njp', style as never, (t) => t.length * 50);
    // A descender reaches about 0.22 em below the baseline.
    for (const [i, line] of layout.lines.entries()) {
      expect(line.y + 22).toBeLessThanOrEqual((i + 1) * 120);
      expect(line.y - 75).toBeGreaterThanOrEqual(i * 120);
    }
  });
});
