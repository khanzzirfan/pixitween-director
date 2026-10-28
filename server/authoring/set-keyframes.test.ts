import { expect, it } from 'vitest';
import { lightValidate } from '../engine/light-validator';
import { setKeyframes } from './transform';
import { mugScene } from './test-helpers';
import type { Comp, Obj } from './types';

const t = (c: Comp) => (((c.precomps as Obj).s1.layers as Obj[]).find((l) => l.id === 's1:product')!).transform;

it('eased scale keys', () => {
  const c = setKeyframes(mugScene(), 's1:product', 'scale', [[0, 0.9], [2, 1]], 'easeOut');
  expect(t(c).scale).toEqual([{ t: 0, v: [0.9, 0.9], easeOut: [0, 0, 0.58, 1] }, { t: 60, v: [1, 1] }]);
  expect(lightValidate(c).ok).toBe(true);
});
it('linear opacity keys have no ease', () => {
  const c = setKeyframes(mugScene(), 's1:product', 'opacity', [[0, 0], [0.6, 1]], 'linear');
  expect(t(c).opacity).toEqual([{ t: 0, v: 0 }, { t: 18, v: 1 }]);
});
it('merges x then y into position keyframes', () => {
  let c = setKeyframes(mugScene(), 's1:product', 'x', [[0, 900], [2, 1000]], 'linear');
  c = setKeyframes(c, 's1:product', 'y', [[1, 500], [3, 600]], 'linear');
  expect(t(c).position).toEqual([{ t: 0, v: [900, 500] }, { t: 30, v: [950, 500] }, { t: 60, v: [1000, 550] }, { t: 90, v: [1000, 600] }]);
  expect(lightValidate(c).ok).toBe(true);
});
it('a single key is a static value', () => {
  expect(t(setKeyframes(mugScene(), 's1:product', 'opacity', [[1, 0.5]])).opacity).toBe(0.5);
});
it('validates times and order', () => {
  expect(() => setKeyframes(mugScene(), 's1:product', 'opacity', [[0, 0], [5, 1]])).toThrow(/time_out_of_range/);
  expect(() => setKeyframes(mugScene(), 's1:product', 'opacity', [[2, 0], [1, 1]])).toThrow(/bad_value/);
  expect(() => setKeyframes(mugScene(), 's1:nope', 'opacity', [[0, 0], [1, 1]])).toThrow(/unknown_layer/);
});
