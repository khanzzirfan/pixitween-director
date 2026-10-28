import { expect, it } from 'vitest';

it('runs in jsdom', () => {
  expect(typeof document).toBe('object');
});

it('has a module url', () => {
  expect(typeof import.meta.url).toBe('string');
});
