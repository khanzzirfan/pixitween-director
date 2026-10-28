import { expect, it } from 'vitest';
import { lightValidate } from '../engine/light-validator';
import { setCamera } from './camera';
import { addLayer, removeLayer } from './layers';
import { setSceneDuration } from './scenes';
import { setTransform } from './transform';
import { MUG, mugScene } from './test-helpers';
import type { Comp, Obj } from './types';

const layer = (c: Comp, id: string) => ((c.precomps as Obj).s1.layers as Obj[]).find((l) => l.id === id)!;
const animated = (c: Comp, id: string) => typeof layer(c, id).transform.position[0] === 'object'; // keyframes, not a static [x, y]

it('a layer added after the camera gets keyframes at once', () => {
  const c = addLayer(setCamera(mugScene(), 's1', 'pan'), { sceneId: 's1', role: 'subject', kind: 'image', assetId: MUG });
  expect(animated(c, 's1:subject')).toBe(true);
  expect(lightValidate(c).ok).toBe(true);
});
it('retiming the scene re-applies the camera', () => {
  const c = setSceneDuration(setCamera(mugScene(), 's1', 'pan'), 's1', 2);
  const kf = layer(c, 's1:product').transform.position;
  expect(kf.at(-1).t).toBe(60);
});
it('setTransform re-centres the pan', () => {
  const c = setTransform(setCamera(mugScene(), 's1', 'pan'), 's1:product', { x: 800 });
  expect(layer(c, 's1:product').transform.position[0].v[0]).toBeCloseTo(800 + 51.2, 3);
});
it('removing a layer keeps the others on the camera', () => {
  expect(animated(removeLayer(setCamera(mugScene(), 's1', 'pan'), 's1:headline'), 's1:product')).toBe(true);
});
it('without a camera nothing gets keyframes', () => {
  let c = addLayer(mugScene(), { sceneId: 's1', role: 'subject', kind: 'image', assetId: MUG });
  c = setTransform(c, 's1:product', { x: 800 });
  c = setSceneDuration(c, 's1', 2);
  c = removeLayer(c, 's1:subject');
  for (const l of (c.precomps as Obj).s1.layers as Obj[]) expect(typeof l.transform.position[0]).toBe('number');
});
