import { expect, it } from 'vitest';
import * as wonder from './s12-wonder';

const call = (name: string, args: unknown, id = 'c') => ({ id, name, args });
const dispatch = { kind: 'build-scene', sceneId: 's1', brief: 'build the hero shot', reason: 'first scene' };
const bible = { palette: ['#1f2937', '#f59e0b'], light: 'warm', camera: 'slow', type: { font: 'sans', weight: 700, case: 'upper' }, productLine: 'a can', mood: 'calm' };

it('describes itself and estimates 30 cents, offline', () => {
  expect(wonder.describe()).toContain('Wonder');
  expect(wonder.estimateUsd()).toBe(0.3);
});

it('accepts a good call for each board tool', () => {
  expect(wonder.checkToolCall('dispatch', dispatch).valid).toBe(true);
  expect(wonder.checkToolCall('setStyleBible', bible).valid).toBe(true);
  expect(wonder.checkToolCall('say', { text: 'Four scenes.' }).valid).toBe(true);
  expect(wonder.checkToolCall('reviseStoryboard', { ops: [{ op: 'remove', sceneId: 's1' }], reason: 'cut it' }).valid).toBe(true);
});

it('rejects an args object that is missing a required field, and says which', () => {
  const { brief: _brief, ...noBrief } = dispatch;
  const r = wonder.checkToolCall('dispatch', noBrief);
  expect(r.valid).toBe(false);
  expect(r.problem).toContain('brief');
  expect(wonder.checkToolCall('say', {}).valid).toBe(false);
  expect(wonder.checkToolCall('setStyleBible', { ...bible, palette: ['orange', '#f59e0b'] }).valid).toBe(false);
  expect(wonder.checkToolCall('reviseStoryboard', { ops: [], reason: 'x' }).valid).toBe(false);
});

it('rejects an unknown tool', () => {
  expect(wonder.checkToolCall('deleteEverything', {})).toMatchObject({ valid: false, problem: 'unknown tool' });
});

it('scores a run: valid calls, parallel dispatch, and cost at $4 in and $20 out per million', () => {
  const r = wonder.scoreRun(1, 200, 1200, [call('setStyleBible', bible), call('dispatch', dispatch, 'a'), call('dispatch', { ...dispatch, sceneId: 's2' }, 'b')], { promptTokens: 1_000_000, completionTokens: 100_000 });
  expect(r).toMatchObject({ toolCalls: 3, validCalls: 3, dispatchCalls: 2, allValid: true, parallelDispatch: true, status: 200 });
  expect(r.usd).toBeCloseTo(6);
});

it('a run with one bad call is not allValid, and one dispatch is not parallel', () => {
  const r = wonder.scoreRun(2, 200, 900, [call('dispatch', { kind: 'build-scene' }), call('say', { text: 'hi' })], undefined);
  expect(r).toMatchObject({ allValid: false, validCalls: 1, parallelDispatch: false });
  expect(r.problems).toHaveLength(1);
  expect(wonder.scoreRun(3, 200, 1, [], undefined).allValid).toBe(false);
});

it('the verdict follows the pass marks: 4 of 5 valid and 3 of 5 parallel', () => {
  const good = (n: number) => wonder.scoreRun(n, 200, 1, [call('dispatch', dispatch, 'a'), call('dispatch', dispatch, 'b')], undefined);
  const bad = (n: number) => wonder.scoreRun(n, 200, 1, [call('say', {})], undefined);
  expect(wonder.verdict([good(1), good(2), good(3), good(4), bad(5)])).toMatchObject({ validRuns: 4, parallelRuns: 4, pass: true });
  expect(wonder.verdict([good(1), good(2), good(3), bad(4), bad(5)]).pass).toBe(false);
  expect(wonder.verdict([wonder.scoreRun(1, 403, 1, [], undefined, 'forbidden')]).access).toBe(false);
});
