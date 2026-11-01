import { describe, expect, it } from 'vitest';
import { isVisible } from './visibility';

describe('isVisible', () => {
  it('is visible inside the half-open window', () => {
    expect(isVisible(1, 1, 2, 6)).toBe(true);
    expect(isVisible(1.5, 1, 2, 6)).toBe(true);
    expect(isVisible(1.999, 1, 2, 6)).toBe(true);
  });

  it('is not visible before the start', () => {
    expect(isVisible(0.999, 1, 2, 6)).toBe(false);
    expect(isVisible(0, 1, 2, 6)).toBe(false);
  });

  it('is not visible at or after the end', () => {
    expect(isVisible(2, 1, 2, 6)).toBe(false);
    expect(isVisible(3, 1, 2, 6)).toBe(false);
  });

  it('keeps a layer visible on the last frame when it ends with the doc', () => {
    expect(isVisible(6, 0, 6, 6)).toBe(true);
  });

  it('excludes a layer ending before the last frame', () => {
    expect(isVisible(6, 0, 5, 6)).toBe(false);
  });
});
