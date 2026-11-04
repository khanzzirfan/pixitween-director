import { expect, it } from 'vitest';
import { levelToGainPoints } from './gainCurve';

it('static and missing levels', () => {
  expect(levelToGainPoints(undefined, 30, 0)).toEqual([[0, 1]]);
  expect(levelToGainPoints(-1, 30, 0)).toEqual([[0, 0]]);
  expect(levelToGainPoints(0.5, 30, 0)).toEqual([[0, 0.5]]);
});
it('maps keyframes relative to the layer start', () => {
  expect(levelToGainPoints([{ t: 15, v: 0 }, { t: 45, v: 0.8 }], 30, 15)).toEqual([[0, 0], [1, 0.8]]);
});
it('interpolates the value at 0 s when a keyframe precedes the layer', () => {
  expect(levelToGainPoints([{ t: 0, v: 0 }, { t: 30, v: 0.8 }], 30, 15)).toEqual([[0, 0.4], [0.5, 0.8]]);
});
it('writes explicit steps for hold keyframes', () => {
  expect(levelToGainPoints([{ t: 0, v: 0.2, hold: true }, { t: 30, v: 1 }], 30, 0)).toEqual([[0, 0.2], [1, 0.2], [1, 1]]);
});
it('uses the last value when every keyframe precedes the layer', () => {
  expect(levelToGainPoints([{ t: 0, v: 0.3 }, { t: 10, v: 0.9 }], 30, 60)).toEqual([[0, 0.9]]);
});
