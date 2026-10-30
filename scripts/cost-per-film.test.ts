import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { runCostCli } from './cost-per-film';

const events = readFileSync(new URL('../fixtures/s10/sample-events.jsonl', import.meta.url), 'utf8');

it('prints the sample table with the sam row, the skipped line and the credits', () => {
  const r = runCostCli(['x.jsonl'], { readFile: () => events });
  expect(r.code).toBe(0);
  expect(r.output).toContain('sam-3.1');
  expect(r.output).toContain('Skipped lines: 1');
  expect(r.output).toContain('Clippy credits: 25');
});

it('returns 2 with a usage line for a file that is not .json or .jsonl', () => {
  const r = runCostCli(['x.txt']);
  expect(r.code).toBe(2);
  expect(r.output.startsWith('usage:')).toBe(true);
  expect(runCostCli([]).code).toBe(2);
});

it('returns 2 naming the file when it cannot be read', () => {
  const r = runCostCli(['missing.json'], { readFile: () => { throw new Error('ENOENT'); } });
  expect(r.code).toBe(2);
  expect(r.output).toContain('missing.json');
});

it('reads a ledger .json and reports one that is not valid JSON', () => {
  const ledger = JSON.stringify({ filmId: 'f', entries: [{ model: 'm', units: '', usd: 0.5 }] });
  expect(runCostCli(['l.json'], { readFile: () => ledger }).output).toContain('0.5000');
  expect(runCostCli(['l.json'], { readFile: () => '{ nope' }).code).toBe(2);
});
