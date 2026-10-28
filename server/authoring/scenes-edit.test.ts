import { expect, it } from 'vitest';
import { lightValidate } from '../engine/light-validator';
import { readDirector } from './meta';
import { removeScene, setSceneDuration, swapScenes } from './scenes';
import { deepFreeze, threeSceneFilm } from './test-helpers';
import type { Comp, Obj } from './types';

function film(): Comp {
  const c = threeSceneFilm();
  const tr = { position: [0, 0], anchor: [0, 0], scale: [1, 1], rotation: 0, opacity: 1 };
  for (const [id, frames] of [['s1', 120], ['s2', 90], ['s3', 60]] as const) {
    (c.precomps as Obj)[id].layers = [
      { kind: 'shape', id: `${id}:bg`, inPoint: 0, outPoint: frames, transform: { ...tr, opacity: id === 's1' ? [{ t: 0, v: 0 }, { t: 90, v: 1 }] : 1 }, path: { kind: 'rect', size: [10, 10] }, fill: '#fff' },
    ];
    readDirector(c); // layers meta
  }
  const meta = readDirector(c);
  for (const id of ['s1', 's2', 's3']) meta.layers[`${id}:bg`] = { sceneId: id, role: 'bg', z: 10 };
  (c.meta as Obj).director = meta;
  return c;
}

it('setSceneDuration retimes later scenes and clamps keyframes', () => {
  const input = deepFreeze(film());
  const c = setSceneDuration(input, 's1', 2);
  const p = (c.precomps as Obj).s1;
  expect(p.durationInFrames).toBe(60);
  expect(p.layers[0].outPoint).toBe(60);
  expect(p.layers[0].transform.opacity.map((k: Obj) => k.t)).toEqual([0, 60]);
  expect(readDirector(c).scenes.s2!.startFrame).toBe(60);
  expect(readDirector(c).scenes.s3!.startFrame).toBe(150);
  expect(lightValidate(c).ok).toBe(true);
});
it('swapScenes reorders the root layers', () => {
  const c = swapScenes(film(), 's1', 's3');
  expect((c.layers as Obj[]).map((l) => l.id)).toEqual(['s3', 's2', 's1']);
  const m = readDirector(c).scenes;
  expect([m.s3!.startFrame, m.s2!.startFrame, m.s1!.startFrame]).toEqual([0, 60, 150]);
  expect(lightValidate(c).ok).toBe(true);
  expect(() => swapScenes(film(), 's1', 'nope')).toThrow(/unknown_scene/);
});
it('removeScene drops the precomp and its meta', () => {
  const c = removeScene(film(), 's2');
  expect((c.precomps as Obj).s2).toBeUndefined();
  expect(Object.values(readDirector(c).layers).some((l) => l.sceneId === 's2')).toBe(false);
  expect(readDirector(c).scenes.s2).toBeUndefined();
  expect([readDirector(c).scenes.s1!.startFrame, readDirector(c).scenes.s3!.startFrame]).toEqual([0, 120]);
  expect(lightValidate(c).ok).toBe(true);
});
