import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { runLive } from './run';
import * as smoke from './s02-smoke';

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'live-'));
  const counter = join(dir, 'count.txt');
  writeFileSync(
    join(dir, 'fake.ts'),
    `import { appendFileSync } from 'node:fs';
export const describe = () => 'A fake script';
export const estimateUsd = () => 0.5;
export const run = async () => { appendFileSync(${JSON.stringify(counter)}, 'x'); };
`,
  );
  const lines: string[] = [];
  const runs = async () => (await import('node:fs')).existsSync(counter) ? (await import('node:fs')).readFileSync(counter, 'utf8').length : 0;
  return { dir, lines, log: (l: string) => lines.push(l), runs };
}

it('a dry run prints the description and estimate and never runs', async () => {
  const s = setup();
  expect(await runLive(['fake'], { dir: s.dir, log: s.log })).toBe(0);
  expect(s.lines.join('\n')).toContain('A fake script');
  expect(s.lines.join('\n')).toContain('estimated cost: $0.5');
  expect(s.lines.join('\n')).toContain('Dry run. Pass --yes to run.');
  expect(await s.runs()).toBe(0);
});

it('--yes runs exactly once', async () => {
  const s = setup();
  expect(await runLive(['fake', '--yes'], { dir: s.dir, log: s.log })).toBe(0);
  expect(await s.runs()).toBe(1);
});

it('unknown and missing names return 2 and list the scripts', async () => {
  const s = setup();
  expect(await runLive(['nope'], { dir: s.dir, log: s.log })).toBe(2);
  expect(s.lines.join('\n')).toContain('fake');
  expect(await runLive([], { dir: s.dir, log: s.log })).toBe(2);
  expect(await runLive(['../etc/passwd'], { dir: s.dir, log: s.log })).toBe(2);
});

it('s02-smoke is a 3-cent estimate over all four clients and is never run here', () => {
  expect(smoke.estimateUsd()).toBe(0.03);
  for (const part of ['spark', 'image', 'sam', 'transcribe']) expect(smoke.describe()).toContain(part);
});
