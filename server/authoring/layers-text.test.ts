import { expect, it } from 'vitest';
import { lightValidate } from '../engine/light-validator';
import { addLayer, setText } from './layers';
import { mugScene } from './test-helpers';
import type { Comp, Obj } from './types';

const layer = (c: Comp, id: string) => ((c.precomps as Obj).s1.layers as Obj[]).find((l) => l.id === id)!;

it('headline defaults', () => {
  const h = layer(mugScene(), 's1:headline');
  expect(h.source).toBe('Slow mornings');
  expect(h.style).toMatchObject({ size: 76, fill: '#ffffff', weight: 700, align: 'center', boxWidth: 1536 });
  expect(h.transform.position).toEqual([960, 172.8]);
  expect(h.transform.anchor).toEqual([960, 540]);
});
it('caption defaults', () => {
  const c = addLayer(mugScene(), { sceneId: 's1', role: 'caption', kind: 'text', text: 'Hi' });
  const l = layer(c, 's1:caption');
  expect(l.style.size).toBe(43);
  expect(l.transform.position).toEqual([960, 961.2]);
  expect(lightValidate(c).ok).toBe(true);
});
it('color is an alias for fill', () => {
  const c = addLayer(mugScene(), { sceneId: 's1', role: 'caption', kind: 'text', text: 'Hi', style: { color: '#ff0000', size: 90 } });
  const s = layer(c, 's1:caption').style;
  expect(s.fill).toBe('#ff0000');
  expect(s.size).toBe(90);
  expect('color' in s).toBe(false);
});
it('limits text length', () => {
  expect(() => addLayer(mugScene(), { sceneId: 's1', role: 'caption', kind: 'text', text: 'x'.repeat(121) })).toThrow(/bad_value/);
  expect(() => addLayer(mugScene(), { sceneId: 's1', role: 'caption', kind: 'text', text: '' })).toThrow(/bad_value/);
});
it('setText keeps other style keys and rejects non-text layers', () => {
  const c = setText(mugScene(), 's1:headline', 'New words', { color: '#00ff00' });
  const l = layer(c, 's1:headline');
  expect(l.source).toBe('New words');
  expect(l.style).toMatchObject({ fill: '#00ff00', size: 76, weight: 700 });
  expect(() => setText(mugScene(), 's1:bg', 'x')).toThrow(/invalid_role_kind/);
  expect(() => setText(mugScene(), 's1:nope', 'x')).toThrow(/unknown_layer/);
  expect(lightValidate(c).ok).toBe(true);
});
