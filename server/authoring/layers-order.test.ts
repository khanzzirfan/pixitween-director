import { expect, it } from 'vitest';
import { lightValidate } from '../engine/light-validator';
import { addLayer, removeLayer, reorderLayer, setLayerHidden } from './layers';
import { readDirector } from './meta';
import { MUG, mugScene } from './test-helpers';
import type { Comp, Obj } from './types';

const ids = (c: Comp) => ((c.precomps as Obj).s1.layers as Obj[]).map((l) => l.id);
const z = (c: Comp, id: string) => readDirector(c).layers[id]!.z;

it('reorders by z', () => {
  const c = reorderLayer(mugScene(), 's1:headline', { below: 's1:product' });
  expect(z(c, 's1:headline')).toBe(1.01);
  expect(ids(c)).toEqual(['s1:bg', 's1:headline', 's1:product']);
  const front = reorderLayer(mugScene(), 's1:bg', 'front');
  expect(z(front, 's1:bg')).toBe(-1);
  expect(ids(front)).toEqual(['s1:product', 's1:headline', 's1:bg']);
  const back = reorderLayer(mugScene(), 's1:product', 'back');
  expect(z(back, 's1:product')).toBe(11);
  expect(ids(back)[0]).toBe('s1:product');
  expect(lightValidate(back).ok).toBe(true);
});
it('rejects a reference from another scene', () => {
  expect(() => reorderLayer(mugScene(), 's1:headline', { above: 's2:product' })).toThrow(/bad_value/);
});
it('removes a layer and its asset copy only when unused', () => {
  const c = removeLayer(mugScene(), 's1:product');
  expect(ids(c)).toEqual(['s1:bg', 's1:headline']);
  expect(readDirector(c).layers['s1:product']).toBeUndefined();
  expect((c.precomps as Obj).s1.assets[MUG]).toBeUndefined();
  const two = removeLayer(addLayer(mugScene(), { sceneId: 's1', role: 'subject', kind: 'image', assetId: MUG }), 's1:product');
  expect((two.precomps as Obj).s1.assets[MUG]).toBeDefined();
  expect(lightValidate(c).ok).toBe(true);
});
it('unknown layers list the scene ids', () => {
  expect(() => removeLayer(mugScene(), 's1:nope')).toThrow(/Valid ids: .*s1:bg/);
});
it('hides and unhides', () => {
  const hidden = setLayerHidden(mugScene(), 's1:product', true);
  expect(((hidden.precomps as Obj).s1.layers as Obj[]).find((l) => l.id === 's1:product')!.hidden).toBe(true);
  const shown = setLayerHidden(hidden, 's1:product', false);
  expect('hidden' in ((shown.precomps as Obj).s1.layers as Obj[]).find((l) => l.id === 's1:product')!).toBe(false);
  expect(lightValidate(hidden).ok && lightValidate(shown).ok).toBe(true);
});
