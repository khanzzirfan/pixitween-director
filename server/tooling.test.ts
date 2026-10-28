import { expect, it } from 'vitest';
import { readSeedJson, readSeedText } from './test-utils/fixtures';

it('runs on Node 22 or newer', () => {
  expect(Number(process.versions.node.split('.')[0])).toBeGreaterThanOrEqual(22);
});

it('reads seed fixtures', () => {
  expect(readSeedText('README.md')).toContain('Seed fixtures');
  expect(Array.isArray(readSeedJson('spark-storyboard-response.json').choices)).toBe(true);
});
