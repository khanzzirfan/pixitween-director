import type { TextDropShadow } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { textStyleFrom } from './textStyle';

describe('textStyleFrom', () => {
  it('maps fontSize, stroke and word wrap', () => {
    const style = textStyleFrom({ fontSize: 80, stroke: { color: '#000000', width: 4 }, wordWrapWidth: 600 });

    expect(style.fontSize).toBe(80);
    expect(style.stroke).toEqual({ color: '#000000', width: 4 });
    expect(style.wordWrap).toBe(true);
    expect(style.wordWrapWidth).toBe(600);
  });

  it('maps the drop shadow angle from degrees to radians and passes alpha, blur and distance through', () => {
    const style = textStyleFrom({ dropShadow: { color: '#000000', alpha: 0.3, blur: 8, distance: 12, angle: 90 } });
    const shadow = style.dropShadow as TextDropShadow;

    expect(shadow.angle).toBeCloseTo(Math.PI / 2);
    expect(shadow.alpha).toBe(0.3);
    expect(shadow.blur).toBe(8);
    expect(shadow.distance).toBe(12);
  });

  it('leaves word wrap, stroke and drop shadow off when they are not set', () => {
    const style = textStyleFrom({ fontSize: 32 });

    expect(style.wordWrap ?? false).toBe(false);
    expect(style.stroke).toBeUndefined();
    expect(style.dropShadow).toBeUndefined();
  });
});
