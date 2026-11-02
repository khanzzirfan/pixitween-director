import { describe, expect, it } from 'vitest';
import { MOTION_RULES } from './cinematic-rules';
import { CHANGE_LEVEL, changedShare, judgeMotion, shotMotion, type Gray } from './motion-check';

const gray = (w: number, h: number, f: (x: number, y: number) => number): Gray => {
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = f(x, y);
  return { width: w, height: h, data };
};
const flat = (v: number) => gray(10, 10, () => v);
/** a 3x3 bright square at x */
const square = (x: number) => gray(10, 10, (px, py) => (px >= x && px < x + 3 && py < 3 ? 255 : 0));

describe('changedShare', () => {
  it('is 0 for the same picture and read black to white as 1', () => {
    expect(changedShare(flat(7), flat(7))).toBe(0);
    expect(changedShare(flat(0), flat(255))).toBe(1);
  });
  it('a small thing that moves changes few pixels: the share counts the pixels, the mean change would hide them', () => {
    expect(changedShare(square(0), square(4))).toBeCloseTo(18 / 100, 5);
    expect(changedShare(flat(100), flat(100 + CHANGE_LEVEL))).toBe(0);
    expect(changedShare(flat(100), flat(100 + CHANGE_LEVEL + 1))).toBe(1);
  });
  it('refuses pictures of different sizes', () => {
    expect(() => changedShare(flat(1), gray(5, 5, () => 1))).toThrow(RangeError);
  });
});

describe('shotMotion', () => {
  const times = [0, 0.5, 1, 1.5, 2, 2.5, 3];
  // steps: 0-.5 .5-1 | 1-1.5 1.5-2 | 2-2.5 2.5-3
  const diffs = [0.05, 0.07, 0.0, 0.0, 0.2, 0.3];
  const shots = [{ start: 0, end: 1 }, { start: 1, end: 2 }, { start: 2, end: 3 }];
  it('gives each shot the steps that lie wholly inside it', () => {
    const m = shotMotion(times, diffs, shots);
    expect(m.map((x) => x.steps)).toEqual([2, 2, 2]);
    expect(m[0]!.median).toBeCloseTo(0.06, 5);
    expect(m[1]!.median).toBe(0);
    expect(m[2]!.peak).toBe(0.3);
  });
  it('leaves a step that crosses a cut out, so a cut is not mistaken for a camera move', () => {
    const m = shotMotion([0, 0.5, 1.2, 2], [0.01, 0.9, 0.02], [{ start: 0, end: 1 }, { start: 1, end: 2 }]);
    expect(m[0]!.steps).toBe(1);
    expect(m[1]!.steps).toBe(1);
    expect(m[0]!.peak).toBe(0.01);
    expect(m[1]!.peak).toBe(0.02);
  });
  it('a shot too short to hold a step has none', () => {
    expect(shotMotion([0, 1], [0.5], [{ start: 0, end: 0.3 }])[0]!.steps).toBe(0);
  });
});

describe('judgeMotion', () => {
  const R = MOTION_RULES;
  const shot = (n: number, median: number, steps = 10) => ({ shot: n, start: n, end: n + 1, steps, median, mean: median, peak: median });
  it('passes a film that moves, with a calmer hold', () => {
    const v = judgeMotion([shot(0, R.minShot * 3), shot(1, R.minShot * 2), shot(2, R.minHold * 2)], R);
    expect(v.ok).toBe(true);
    expect(v.live).toBe(1);
  });
  it('names a frozen moving shot, and the frame time', () => {
    const v = judgeMotion([shot(0, R.minShot * 3), shot(1, 0), shot(2, R.minHold * 2)], R);
    expect(v.ok).toBe(false);
    expect(v.problems.join('|')).toMatch(/shot 2 \(1\.0-2\.0 s\) is static/);
  });
  it('holds the last shot to the calmer floor, and flags a frozen one', () => {
    expect(judgeMotion([shot(0, R.minShot * 3), shot(1, R.minHold * 1.5)], R).ok).toBe(true);
    expect(judgeMotion([shot(0, R.minShot * 3), shot(1, 0)], R).problems.join('|')).toMatch(/shot 2/);
  });
  it('flags a film that is mostly frozen even when each shot passes alone', () => {
    const shots = [shot(0, R.minShot * 3, 3), shot(1, R.minHold * 0.5, 30), shot(2, R.minShot * 3, 3)];
    const v = judgeMotion(shots, { ...R, minShot: 0, minHold: R.minHold, minLive: 0.85 });
    expect(v.problems.join('|')).toMatch(/only \d+% of the film moves/);
  });
  it('fails a film with nothing to measure', () => {
    expect(judgeMotion([], R).problems.join('|')).toMatch(/nothing could be measured/);
    expect(judgeMotion([shot(0, 0, 0)], R).ok).toBe(false);
  });
  it('skips a shot too short to measure', () => {
    expect(judgeMotion([shot(0, 0, 0), shot(1, R.minHold * 2)], R).ok).toBe(true);
  });
});
