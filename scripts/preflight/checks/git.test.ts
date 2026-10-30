import { expect, it } from 'vitest';
import { makeCtx } from '../testing';
import { checkGitProvenance } from './git';

const run = (date?: string) => checkGitProvenance(makeCtx({}, date ? { firstCommitDate: date } : {}))[0]!.status;

it('fails before the event and passes on and after the day before it started', () => {
  expect(run('2026-10-25')).toBe('fail');
  expect(run('2026-10-26')).toBe('pass');
  expect(run('2026-11-04')).toBe('pass');
});

it('is pending, never a fail, when there is no date', () => {
  expect(run(undefined)).toBe('pending');
});
