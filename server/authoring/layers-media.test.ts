import { expect, it } from 'vitest';
import { lightValidate } from '../engine/light-validator';
import { newFilmComposition, registerAsset } from './composition';
import { addLayer } from './layers';
import { readDirector } from './meta';
import { addScene } from './scenes';
import { MUG, mugScene } from './test-helpers';
import type { Comp, Obj } from './types';

const layers = (c: Comp) => (c.precomps as Obj).s1.layers as Obj[];
const near = (a: number, b: number, d = 1e-4) => expect(Math.abs(a - b)).toBeLessThan(d);

it('adds a product with fitted placement and copies its asset into the scene', () => {
  const c = mugScene();
  const p = layers(c).find((l) => l.id === 's1:product')!;
  expect(p.transform.position).toEqual([960, 561.6]);
  near(p.transform.scale[0], 0.9964);
  expect((c.precomps as Obj).s1.assets[MUG]).toBeDefined();
  expect(readDirector(c).layers['s1:product']).toMatchObject({ sceneId: 's1', role: 'product', assetId: MUG, z: 1 });
  expect(lightValidate(c).ok).toBe(true);
});
it('sorts by z: bg before product', () => {
  expect(layers(mugScene()).map((l) => l.id)).toEqual(['s1:bg', 's1:product', 's1:headline']);
  const bg = layers(mugScene())[0]!;
  expect(bg.transform.position).toEqual([960, 540]);
  expect(bg.path.size).toEqual([1920, 1080]);
  expect(bg.fill).toBe('#111827');
});
it('uses an explicit box exactly and suffixes duplicate roles', () => {
  let c = mugScene();
  c = addLayer(c, { sceneId: 's1', role: 'product', kind: 'image', assetId: MUG, box: { x: 100, y: 100, w: 384, h: 336 } });
  const p2 = layers(c).find((l) => l.id === 's1:product-2')!;
  expect(p2.transform.position).toEqual([292, 268]);
  expect(p2.transform.scale).toEqual([1, 0.5]);
});
it('rejects bad role/kind and unknown assets', () => {
  const c = mugScene();
  expect(() => addLayer(c, { sceneId: 's1', role: 'headline', kind: 'image', assetId: MUG })).toThrow(/invalid_role_kind.*text/);
  expect(() => addLayer(c, { sceneId: 's1', role: 'product', kind: 'image', assetId: 'nope' })).toThrow(/unknown_asset/);
  expect(() => addLayer(c, { sceneId: 'zz', role: 'product', kind: 'image', assetId: MUG })).toThrow(/unknown_scene/);
});
it('adds a video clip with cover scale', () => {
  let c = newFilmComposition({ aspect: '16:9' });
  c = registerAsset(c, { id: 'clip1', kind: 'video', src: '/c.mp4', width: 1280, height: 720 });
  c = addScene(c, { id: 's1', durationSec: 4, mode: 'generate' });
  c = addLayer(c, { sceneId: 's1', role: 'clip', kind: 'video', assetId: 'clip1' });
  const l = layers(c)[0]!;
  expect(l.kind).toBe('video');
  near(l.transform.scale[0], 1.5);
  expect(lightValidate(c).ok).toBe(true);
});
