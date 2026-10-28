import { expect, it } from 'vitest';
import { lightValidate } from '../engine/light-validator';
import { readDirector, writeDirector } from './meta';
import { setKeyframes, setTransform } from './transform';
import { mugScene } from './test-helpers';
import type { Comp, Obj } from './types';

const t = (c: Comp, id: string) => (((c.precomps as Obj).s1.layers as Obj[]).find((l) => l.id === id)!).transform;

it('sets static values', () => {
  const c = setTransform(mugScene(), 's1:product', { x: 800 });
  expect(t(c, 's1:product').position).toEqual([800, 561.6]);
  const d = setTransform(mugScene(), 's1:product', { scale: 1.2, opacity: 0.5, rotation: 10 });
  expect(t(d, 's1:product')).toMatchObject({ scale: [1.2, 1.2], opacity: 0.5, rotation: 10 });
  expect(lightValidate(d).ok).toBe(true);
});
it('validates', () => {
  expect(() => setTransform(mugScene(), 's1:product', { opacity: 2 })).toThrow(/bad_value/);
  expect(() => setTransform(mugScene(), 's1:product', {})).toThrow(/nothing to set/);
  expect(() => setTransform(mugScene(), 's1:product', { scale: -1 })).toThrow(/bad_value/);
});
it('replaces scale keyframes with a static value', () => {
  const animated = setKeyframes(mugScene(), 's1:product', 'scale', [[0, 0.9], [2, 1]], 'easeOut');
  expect(Array.isArray(t(animated, 's1:product').scale)).toBe(true);
  expect(t(setTransform(animated, 's1:product', { scale: 1.1 }), 's1:product').scale).toEqual([1.1, 1.1]);
});
it('refreshes camera base for affected layers only', () => {
  let c = mugScene();
  const meta = readDirector(c);
  meta.scenes.s1!.camera = { move: 'pan', strength: 0.5 };
  c = writeDirector(c, meta);
  c = setTransform(setTransform(c, 's1:product', { x: 700, scale: 1.5 }), 's1:headline', { x: 500 });
  expect(readDirector(c).layers['s1:product']!.base).toEqual({ x: 700, y: 561.6, scale: 1.5 });
  expect(readDirector(c).layers['s1:headline']!.base).toBeUndefined();
});
