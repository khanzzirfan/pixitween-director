import { describe, expect, it } from 'vitest';
import { SPACE_EM, textEm } from './text-width';

describe('textEm', () => {
  it('measures with Helvetica advance widths, a little wider for Inter', () => {
    // H 722 + e 556 + l 222 + l 222 + o 556 = 2278 / 1000, times 1.03
    expect(textEm('Hello')).toBeCloseTo(2.278 * 1.03, 6);
  });
  it('a bold word is wider than the same word regular', () => {
    expect(textEm('Cooler', true)).toBeGreaterThan(textEm('Cooler'));
  });
  it('narrow letters are narrower than wide ones', () => {
    expect(textEm('iii')).toBeLessThan(textEm('mmm') / 2);
    expect(textEm('WWW')).toBeGreaterThan(textEm('lll') * 3);
  });
  it('a character outside the tables still takes room, and the empty string none', () => {
    expect(textEm('é')).toBeGreaterThan(0.5);
    expect(textEm('')).toBe(0);
  });
  it('a space is 0.278 em (a little more for Inter)', () => {
    expect(SPACE_EM).toBeCloseTo(0.278 * 1.03, 6);
    expect(textEm(' ')).toBeCloseTo(SPACE_EM, 6);
  });
});

describe('scripts that are not Latin', () => {
  it('full-width characters are about one em each, accented letters about a letter', () => {
    expect(textEm('夏天')).toBeGreaterThan(1.8);
    expect(textEm('é')).toBeCloseTo(textEm('e'), 1);
  });
});
