import { expect, it } from 'vitest';
import { ASPECT_SIZES, FILM_FPS, isAssetId, isFilmId } from './composition';

it('sizes', () => {
  expect(ASPECT_SIZES['9:16']).toEqual({ width: 1080, height: 1920 });
  expect(ASPECT_SIZES['16:9']).toEqual({ width: 1920, height: 1080 });
  expect(FILM_FPS).toBe(30);
});
it('film ids', () => {
  expect(isFilmId('film_3fa9c2d41b7e')).toBe(true);
  for (const bad of ['film_../x', 'film_3fa9c2d41b7e/../x', 'film_3FA9C2D41B7E', 'film_3fa9c2d41b7', 42]) expect(isFilmId(bad)).toBe(false);
});
it('asset ids', () => {
  expect(isAssetId('ast_0123456789abcdef0123456789abcdef')).toBe(true);
  expect(isAssetId('ast_0123456789abcdef')).toBe(false);
  expect(isAssetId('ast_0123')).toBe(false);
});
