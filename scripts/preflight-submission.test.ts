import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { buildContext } from './preflight/context';
import { makeCtx } from './preflight/testing';
import type { NamedCheck } from './preflight/types';
import { runCli } from './preflight-submission';

const checks: NamedCheck[] = [
  { id: 'a', run: () => [{ id: 'license', title: 'l', status: 'pass', detail: '' }] },
  { id: 'b', run: () => [{ id: 'owner.markers', title: 'm', status: 'pending', detail: 'gif' }] },
  { id: 'c', run: () => [{ id: 'license.extra', title: 'x', status: 'pass', detail: '' }] },
];
const run = (argv: string[]) => {
  const lines: string[] = [];
  const code = runCli(argv, { ctx: makeCtx({}), checks, print: (t) => lines.push(t) });
  return { code, out: lines.join('\n') };
};

it('returns 1 under --strict when the only non-pass result is pending, and 0 without it', () => {
  expect(run(['--strict']).code).toBe(1);
  expect(run([]).code).toBe(0);
});

it('--only prints just the results whose id starts with the prefix', () => {
  const { out, code } = run(['--only', 'license']);
  expect(out).toContain('license');
  expect(out).toContain('license.extra');
  expect(out).not.toContain('owner.markers');
  expect(code).toBe(0); // the pending one is filtered out
  expect(run(['--only']).code).toBe(2);
});

it('--json prints an array whose items have id, title, status and detail', () => {
  const parsed = JSON.parse(run(['--json']).out) as Array<Record<string, unknown>>;
  expect(parsed).toHaveLength(3);
  for (const r of parsed) expect(Object.keys(r).sort()).toEqual(['detail', 'id', 'status', 'title']);
});

it('buildContext lists files from a directory walk when git is not there, and skips node_modules', () => {
  const dir = mkdtempSync(join(tmpdir(), 'preflight-'));
  mkdirSync(join(dir, 'docs'));
  mkdirSync(join(dir, 'node_modules/x'), { recursive: true });
  writeFileSync(join(dir, 'README.md'), '# hi');
  writeFileSync(join(dir, 'docs/a.md'), 'a');
  writeFileSync(join(dir, 'node_modules/x/i.js'), '');
  const ctx = buildContext(dir, { gitLsFiles: () => undefined, gitFirstCommit: () => undefined });
  expect(ctx.tracked.sort()).toEqual(['README.md', 'docs/a.md']);
  expect(ctx.readText('README.md')).toBe('# hi');
  expect(ctx.readText('nope')).toBeUndefined();
  expect(ctx.firstCommitDate).toBeUndefined();
  expect(ctx.json('README.md')).toBeUndefined();
  expect(ctx.sizeOf('docs/a.md')).toBe(1);
});

it('buildContext uses the injected git list and drops a path that is no longer on disk', () => {
  const dir = mkdtempSync(join(tmpdir(), 'preflight-'));
  writeFileSync(join(dir, 'a.txt'), 'a');
  const ctx = buildContext(dir, { gitLsFiles: () => ['a.txt', 'gone.txt'], gitFirstCommit: () => '2026-10-28' });
  expect(ctx.tracked).toEqual(['a.txt']);
  expect(ctx.firstCommitDate).toBe('2026-10-28');
});
