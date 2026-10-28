import { expect, it } from 'vitest';
import { type AuthoringError } from './errors';
import { getProductNoun, readDirector, sceneIds, sceneMeta, setProductNoun, writeDirector } from './meta';
import { deepFreeze, threeSceneFilm } from './test-helpers';
import type { Comp } from './types';

const bare = { version: '1.8.0', id: 'film', width: 1, height: 1, fps: 30, durationInFrames: 1, assets: {}, layers: [] } as unknown as Comp;

it('reads empty maps when meta is absent', () => expect(readDirector(bare)).toEqual({ scenes: {}, layers: {} }));

it('write keeps unrelated keys and does not mutate', () => {
  const c = deepFreeze({ ...bare, meta: { x: 1 } } as Comp);
  const out = writeDirector(c, { scenes: {}, layers: {} });
  expect(out.meta).toEqual({ x: 1, director: { scenes: {}, layers: {} } });
  expect(c.meta).toEqual({ x: 1 });
});

it('sceneMeta throws unknown_scene listing existing ids', () => {
  const c = threeSceneFilm();
  const e = (() => { try { sceneMeta(c, 'nope'); } catch (err) { return err as AuthoringError; } })()!;
  expect(e.code).toBe('unknown_scene');
  expect(e.message).toContain('s1, s2, s3');
});

it('sceneIds follows root layer order', () => {
  const c = threeSceneFilm();
  c.layers.reverse();
  expect(sceneIds(c)).toEqual(['s3', 's2', 's1']);
});

it('product noun round-trips and survives writeDirector', () => {
  const c = setProductNoun(threeSceneFilm(), ' mug ');
  expect(getProductNoun(c)).toBe('mug');
  expect(getProductNoun(writeDirector(c, readDirector(c)))).toBe('mug');
  expect(() => setProductNoun(c, '  ')).toThrow(/bad_value/);
});
