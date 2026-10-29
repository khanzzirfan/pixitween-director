import { expect, it } from 'vitest';
import * as live from './s09-local';

it('exports the live-script shape and starts nothing on import', () => {
  expect(live.describe().length).toBeGreaterThan(0);
  expect(typeof live.estimateUsd).toBe('function');
  expect(typeof live.run).toBe('function');
});

it('costs nothing locally and about a cent with --with-spark', () => {
  expect(live.estimateUsd([])).toBe(0);
  expect(live.estimateUsd(['--with-spark'])).toBe(0.01);
});

it('formats a markdown table with a header, a separator and one row per result', () => {
  const rows: live.AbRow[] = [
    { edit: 'swap-scenes', backend: 'glimmer', correct: true, ms: 24300, toolCallsOk: 1, tokPerSec: 21.2 },
    { edit: 'remove-caption', backend: 'spark', correct: false, ms: 14000, toolCallsOk: 0 },
  ];
  const lines = live.formatAbTable(rows).split('\n');
  expect(lines).toHaveLength(4);
  expect(lines[0]).toContain('edit');
  expect(lines[1]).toMatch(/^\| --- /);
  expect(lines[2]).toContain('21.2');
  expect(lines[3]).toContain('| no |');
});

it('numbers iterations from 01', () => {
  expect(live.nextIterationDir([])).toBe('iteration-01');
  expect(live.nextIterationDir(['iteration-01', 'iteration-03'])).toBe('iteration-04');
});
