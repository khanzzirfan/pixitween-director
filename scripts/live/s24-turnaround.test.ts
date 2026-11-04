import { expect, it } from 'vitest';
import { describe as describeScript, estimateUsd, parseArgs } from './s24-turnaround';

it('says it needs the web server on 5199', () => {
  expect(describeScript()).toContain('5199');
});

it('estimates at most 0.15 USD, with a dollar sign in the runner output', () => {
  expect(estimateUsd()).toBeLessThanOrEqual(0.15);
});

it('takes several photos and --base, in either form', () => {
  expect(parseArgs(['a.png', 'b.JPG', 'c.jpeg'])).toEqual({ photos: ['a.png', 'b.JPG', 'c.jpeg'], base: 'http://localhost:5199' });
  expect(parseArgs(['--base', 'http://localhost:5180', 'a.png'])).toEqual({ photos: ['a.png'], base: 'http://localhost:5180' });
  expect(parseArgs(['--base=http://x:1']).base).toBe('http://x:1');
  expect(parseArgs()).toEqual({ photos: [], base: 'http://localhost:5199' });
});

it('rejects an unknown flag, a non-photo and a bad --base with a message', () => {
  expect(() => parseArgs(['--fast'])).toThrow(/unknown flag --fast/);
  expect(() => parseArgs(['notes.txt'])).toThrow(/\.png or \.jpg/);
  expect(() => parseArgs(['--base', 'nope'])).toThrow(/url/);
});

it('re-renders a saved run with --from, for nothing', () => {
  expect(parseArgs(['--from', 'debug/turnaround/x'])).toEqual({ photos: [], base: 'http://localhost:5199', from: 'debug/turnaround/x' });
  expect(estimateUsd(['--from', 'debug/turnaround/x'])).toBe(0);
  expect(estimateUsd([])).toBe(0.1);
  expect(() => parseArgs(['--from'])).toThrow(/run folder/);
  expect(() => parseArgs(['--from', 'x', 'a.png'])).toThrow(/no photos/);
});
