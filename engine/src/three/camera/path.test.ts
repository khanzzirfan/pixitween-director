import { describe, expect, it } from 'vitest';
import { CameraPathSchema, type CameraPath } from '../../schema/layer3d';
import { samplePath } from './path';

function makePath(keys: unknown[], curve: 'linear' | 'smooth' = 'linear'): CameraPath {
  const parsed = CameraPathSchema.safeParse({ keys, curve });
  if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues));
  return parsed.data;
}

const KEY_A = { t: 0, position: [0, 1, 6], lookAt: [0, 0.6, 0], fov: 35 };
const KEY_B = { t: 2, position: [2, 3, 4], lookAt: [1, 1, 0], fov: 50 };

describe('samplePath', () => {
  it.each(['linear', 'smooth'] as const)('returns a key’s values exactly on the %s curve', (curve) => {
    const path = makePath([KEY_A, KEY_B], curve);

    const first = samplePath(path, 0);
    expect(first.position).toEqual([0, 1, 6]);
    expect(first.lookAt).toEqual([0, 0.6, 0]);
    expect(first.fov).toBe(35);

    const last = samplePath(path, 2);
    expect(last.position).toEqual([2, 3, 4]);
    expect(last.lookAt).toEqual([1, 1, 0]);
    expect(last.fov).toBe(50);
  });

  it('returns the midpoint at the middle time between two keys with the linear curve', () => {
    const path = makePath([KEY_A, KEY_B], 'linear');

    const middle = samplePath(path, 1);
    expect(middle.position).toEqual([1, 2, 5]);
    expect(middle.lookAt).toEqual([0.5, 0.8, 0]);
    expect(middle.fov).toBe(42.5);
  });

  it('clamps at the ends', () => {
    const path = makePath([KEY_A, KEY_B], 'linear');

    expect(samplePath(path, -5).position).toEqual([0, 1, 6]);
    expect(samplePath(path, -5).fov).toBe(35);
    expect(samplePath(path, 99).position).toEqual([2, 3, 4]);
    expect(samplePath(path, 99).fov).toBe(50);
  });

  it('bows away from the straight line on the smooth curve', () => {
    const path = makePath(
      [
        { t: 0, position: [0, 0, 0], lookAt: [0, 0, 0] },
        { t: 1, position: [1, 1, 0], lookAt: [0, 0, 0] },
        { t: 2, position: [2, 0, 0], lookAt: [0, 0, 0] },
      ],
      'smooth',
    );

    const middle = samplePath(path, 0.5);
    // The straight line would be at half the height; the spline follows the tangents instead.
    expect(middle.position[1]).not.toBeCloseTo(0.5, 6);
    expect(middle.position[1]).toBeGreaterThan(0.5);
    // The curve still runs through the key itself.
    expect(samplePath(path, 1).position).toEqual([1, 1, 0]);
  });

  it('moves in a straight line when the path has only two keys', () => {
    // With no neighbouring keys to bend towards, the spline of two keys is the straight line.
    const path = makePath([KEY_A, KEY_B], 'smooth');

    expect(samplePath(path, 1).position).toEqual([1, 2, 5]);
    expect(samplePath(path, 0.5).position).toEqual([0.5, 1.5, 5.5]);
  });

  it('holds the lens of the last key that set it', () => {
    const path = makePath([
      { t: 0, position: [0, 0, 0], lookAt: [0, 0, 0] },
      { t: 1, position: [1, 0, 0], lookAt: [0, 0, 0], fov: 50 },
      { t: 2, position: [2, 0, 0], lookAt: [0, 0, 0] },
    ]);

    expect(samplePath(path, 0).fov).toBe(35);
    expect(samplePath(path, 1).fov).toBe(50);
    expect(samplePath(path, 2).fov).toBe(50);
    expect(samplePath(path, 1.5).fov).toBe(50);
  });

  it('takes the fallback lens for a path that says nothing about the fov', () => {
    const path = makePath([
      { t: 0, position: [0, 0, 0], lookAt: [0, 0, 0] },
      { t: 1, position: [1, 0, 0], lookAt: [0, 0, 0] },
    ]);

    expect(samplePath(path, 0.5).fov).toBe(35);
    expect(samplePath(path, 0.5, 60).fov).toBe(60);
  });

  it('is stateless: the same time always gives the same pose', () => {
    const path = makePath([KEY_A, KEY_B], 'smooth');

    const first = samplePath(path, 1.25);
    samplePath(path, 0);
    const again = samplePath(path, 1.25);

    expect(again).toEqual(first);
  });

  it('follows unevenly spaced keys without changing speed at the keys', () => {
    const path = makePath([
      { t: 0, position: [0, 0, 0], lookAt: [0, 0, 0] },
      { t: 1, position: [1, 0, 0], lookAt: [0, 0, 0] },
      { t: 4, position: [2, 0, 0], lookAt: [0, 0, 0] },
    ]);

    // The segment from 1 s to 4 s is three times as long, so a third of it is a third of the way.
    const third = samplePath(path, 2);
    expect(third.position[0]).toBeCloseTo(4 / 3, 9);
  });
});
