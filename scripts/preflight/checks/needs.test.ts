import { expect, it } from 'vitest';
import { makeCtx } from '../testing';
import { checkEngineNeeds } from './needs';

const run = (text?: string) => checkEngineNeeds(makeCtx(text === undefined ? {} : { 'ENGINE-NEEDS.md': text }))[0]!;

it('is pending without a stamp, pass with one, fail without the file', () => {
  expect(run('# gaps\n| a | b |').status).toBe('pending');
  expect(run('# gaps\nReviewed: 2026-11-03\n').status).toBe('pass');
  expect(run().status).toBe('fail');
});

it('does not count another date format as a stamp', () => {
  expect(run('Reviewed: 03/11/2026').status).toBe('pending');
});
