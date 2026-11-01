import { expect, it } from 'vitest';
import { addLayer } from './layers';
import { readDirector } from './meta';
import { layerIdsByRole, layerInfo, markPlaceholder, sceneInfo } from './read';
import { addScene } from './scenes';
import { MUG, mugScene } from './test-helpers';

function film() {
  let c = addScene(mugScene(), { id: 's2', durationSec: 4, mode: 'generate' });
  c = addLayer(c, { sceneId: 's2', role: 'bg', kind: 'shape' });
  return c;
}

it('sceneInfo', () => {
  const info = sceneInfo(film());
  expect(info.map((s) => [s.id, s.startSec, s.durationSec])).toEqual([['s1', 0, 4], ['s2', 4, 4]]);
  expect(info[0]!.layerIds).toEqual(['s1:bg', 's1:product', 's1:headline']);
  expect(info[1]!.mode).toBe('generate');
});
it('layerIdsByRole', () => {
  expect(layerIdsByRole(film(), 'bg')).toEqual(['s1:bg', 's2:bg']);
  expect(layerIdsByRole(film(), 'bg', 's2')).toEqual(['s2:bg']);
});
it('layerInfo', () => {
  expect(layerInfo(film(), 's1:product')).toEqual({ id: 's1:product', sceneId: 's1', role: 'product', kind: 'image', assetId: MUG, z: 1 });
  expect(() => layerInfo(film(), 'nope')).toThrow(/unknown_layer/);
});
it('markPlaceholder sets and clears', () => {
  const on = markPlaceholder(film(), 's2:bg', true);
  expect(readDirector(on).layers['s2:bg']!.placeholder).toBe(true);
  expect('placeholder' in readDirector(markPlaceholder(on, 's2:bg', false)).layers['s2:bg']!).toBe(false);
});
