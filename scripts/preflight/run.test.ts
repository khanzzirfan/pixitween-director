import { expect, it } from 'vitest';
import { exitCode, formatResults, runChecks } from './run';
import { makeCtx } from './testing';
import type { CheckResult } from './types';

const r = (status: CheckResult['status'], id = 'x'): CheckResult => ({ id, title: 't', status, detail: '' });

it('exits 0 for pass and pending, and 1 for pending only when strict', () => {
  expect(exitCode([r('pass'), r('pending')], false)).toBe(0);
  expect(exitCode([r('pass'), r('pending')], true)).toBe(1);
  expect(exitCode([r('pass')], true)).toBe(0);
});

it('exits 1 for any fail, strict or not', () => {
  expect(exitCode([r('pass'), r('fail')], false)).toBe(1);
  expect(exitCode([r('fail')], true)).toBe(1);
});

it('turns a check that throws into exactly one fail whose id ends .error and whose detail has the message', () => {
  const out = runChecks(
    [
      { id: 'boom', run: () => { throw new Error('disk on fire'); } },
      { id: 'fine', run: () => [r('pass', 'fine.one')] },
    ],
    makeCtx({}),
  );
  expect(out).toHaveLength(2);
  expect(out[0]).toMatchObject({ status: 'fail' });
  expect(out[0]!.id.endsWith('.error')).toBe(true);
  expect(out[0]!.detail).toContain('disk on fire');
  expect(out[1]!.id).toBe('fine.one');
});

it('ends the table with the counts', () => {
  const text = formatResults([r('pass', 'a'), r('pass', 'b'), r('fail', 'c'), r('pending', 'd')]);
  expect(text.trimEnd().split('\n').at(-1)).toBe('2 pass, 1 fail, 1 pending');
  expect(text).toContain('FAIL    c');
});
