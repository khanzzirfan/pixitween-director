import { expect, it } from 'vitest';
import { lightValidate } from '../engine/light-validator';
import { newFilmComposition, registerAsset, setAssetSrc } from './composition';
import { deepFreeze } from './test-helpers';
import type { Comp, Obj } from './types';

it('creates a valid empty 9:16 film', () => {
  const c = newFilmComposition({ aspect: '9:16' });
  expect(c).toMatchObject({ version: '1.9.0', width: 1080, height: 1920, fps: 30, durationInFrames: 1 });
  expect(lightValidate(c).ok).toBe(true);
});

it('registers assets, passing duration through only when given', () => {
  let c = newFilmComposition({ aspect: '16:9' });
  c = registerAsset(c, { id: 'a', kind: 'image', src: '/a.png', width: 4, height: 5 });
  c = registerAsset(c, { id: 'v', kind: 'video', src: '/v.mp4', duration: 150 });
  expect(c.assets.a).toEqual({ type: 'image', src: '/a.png', width: 4, height: 5 });
  expect(c.assets.v).toEqual({ type: 'video', src: '/v.mp4', duration: 150 });
  expect(registerAsset(c, { id: 'a', kind: 'image', src: '/b.png' }).assets.a!.src).toBe('/b.png');
});

it('setAssetSrc updates the root and precomp copies, and rejects unknown ids', () => {
  let c = registerAsset(newFilmComposition({ aspect: '16:9' }), { id: 'a', kind: 'image', src: '/old.png' });
  (c.precomps as Obj).s1 = { assets: { a: { type: 'image', src: '/old.png' } }, layers: [] };
  c = setAssetSrc(c, 'a', '/new.png');
  expect(c.assets.a!.src).toBe('/new.png');
  expect((c.precomps as Obj).s1.assets.a.src).toBe('/new.png');
  expect(() => setAssetSrc(c, 'zzz', '/x')).toThrow(/unknown_asset/);
});

it('never mutates its input', () => {
  const frozen = deepFreeze(newFilmComposition({ aspect: '16:9' })) as Comp;
  expect(() => registerAsset(frozen, { id: 'a', kind: 'image', src: '/a' })).not.toThrow();
});
