import { expect, it } from 'vitest';
import { createDeadline } from './deadline';

const at = (ms: number) => {
  let t = 0;
  const d = createDeadline(180_000, () => t);
  t = ms;
  return d;
};

it('moves through the phases at 25, 110, 160 and 180 seconds', () => {
  expect([0, 24_999, 25_000, 109_999, 110_000, 159_999, 160_000, 180_000].map((ms) => at(ms).phase())).toEqual(['plan', 'plan', 'build', 'build', 'polish', 'polish', 'wrap', 'wrap']);
});

it('polish starts no rebuild, restyle or take, and wrap starts nothing', () => {
  expect(at(120_000).mayStart('edit')).toBe(true);
  expect(at(120_000).mayStart('build-scene')).toBe(true);
  expect(at(120_000).mayStart('rebuild-scene')).toBe(false);
  expect(at(120_000).mayStart('take')).toBe(false);
  expect(at(170_000).mayStart('critique')).toBe(false);
});

it('late notes become edits after 60 s and are refused after 150 s', () => {
  expect(at(59_000).kindFor('restyle-scene')).toBe('restyle-scene');
  expect(at(61_000).kindFor('restyle-scene')).toBe('edit');
  expect(at(61_000).kindFor('rebuild-scene')).toBe('edit');
  expect(at(61_000).kindFor('build-scene')).toBe('build-scene');
  expect(at(151_000).kindFor('edit')).toBeUndefined();
  expect(at(151_000).kindFor('critique')).toBe('critique');
});

it('a build job gets 80 s, a late one 45 s, and none outlives the polish phase', () => {
  expect(at(10_000).jobBudgetMs('build-scene')).toBe(80_000);
  expect(at(100_000).jobBudgetMs('build-scene')).toBe(60_000);
  expect(at(120_000).jobBudgetMs('build-scene')).toBe(40_000);
  expect(at(120_000).jobBudgetMs('edit')).toBe(40_000);
});
