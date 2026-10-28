import { expect, it } from 'vitest';
import { mergePositionAxis, replaceAxisWithStatic } from './axis';

it('merges x then y keys into the position vec2', () => {
  const first = mergePositionAxis([960, 561.6], 'x', [{ t: 0, v: 900 }, { t: 60, v: 1000 }], 30);
  expect(first).toEqual([{ t: 0, v: [900, 561.6] }, { t: 60, v: [1000, 561.6] }]);
  const second = mergePositionAxis(first, 'y', [{ t: 30, v: 500 }, { t: 90, v: 600 }], 30);
  expect(second).toEqual([
    { t: 0, v: [900, 500] }, { t: 30, v: [950, 500] }, { t: 60, v: [1000, 550] }, { t: 90, v: [1000, 600] },
  ]);
  const ts = second.map((k) => k.t);
  expect(ts).toEqual([...new Set(ts)].sort((a, b) => a - b));
});
it('replaces one axis with a static value', () => {
  expect(replaceAxisWithStatic([960, 561.6], 'y', 500)).toEqual([960, 500]);
  expect(replaceAxisWithStatic([{ t: 0, v: [1, 2] }, { t: 5, v: [3, 4] }], 'x', 9)).toEqual([{ t: 0, v: [9, 2] }, { t: 5, v: [9, 4] }]);
});
