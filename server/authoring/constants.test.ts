import { expect, it } from 'vitest';
import { depthWeight, DEFAULT_Z, EASE_HANDLES, MAX_SCENES } from './constants';
import { AuthoringError, hintList } from './errors';

it('depth weight', () => {
  expect(Math.abs(depthWeight(1) - 2 / 3)).toBeLessThan(1e-9);
  expect(Math.abs(depthWeight(10) - 1 / 6)).toBeLessThan(1e-9);
  expect(depthWeight(-3)).toBe(1);
  expect(depthWeight(0)).toBe(1);
});
it('constants', () => {
  expect(DEFAULT_Z).toMatchObject({ bg: 10, product: 1, headline: 0 });
  expect(EASE_HANDLES.easeOut).toEqual([0, 0, 0.58, 1]);
  expect(EASE_HANDLES.linear).toBeUndefined();
  expect(MAX_SCENES).toBe(12);
});
it('errors', () => {
  const e = new AuthoringError('unknown_layer', 'x');
  expect(e.message).toBe('unknown_layer: x');
  expect(e.code).toBe('unknown_layer');
  expect(new AuthoringError('unknown_layer', 'x', 'Valid ids: a').message).toBe('unknown_layer: x. Valid ids: a');
});
it('hintList caps at 8 and handles empty', () => {
  const ids = Array.from({ length: 10 }, (_, i) => `id${i}`);
  expect(hintList(ids).split(',').filter((s) => s.includes('id'))).toHaveLength(8);
  expect(hintList(ids)).not.toContain('id9');
  expect(hintList([])).toBe('There are none yet');
});
