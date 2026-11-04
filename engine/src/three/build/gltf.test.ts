import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { HOLD_EPSILON, clipTime, normalizeGltf, pickClip } from './gltf';

function makeBox(center: [number, number, number], size: [number, number, number]): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]));
  mesh.position.set(center[0], center[1], center[2]);
  return mesh;
}

describe('normalizeGltf', () => {
  it('scales to height, drops the bottom to 0 and centres x on 0', () => {
    const group = new THREE.Group();
    group.add(makeBox([3, 3, 0], [2, 4, 2]));
    const before = new THREE.Box3().setFromObject(group);
    expect(before.min.y).toBeCloseTo(1, 6);
    expect(before.max.y).toBeCloseTo(5, 6);

    const box = normalizeGltf(group, { height: 2 });

    expect(box.max.y - box.min.y).toBeCloseTo(2, 6);
    expect(box.min.y).toBeCloseTo(0, 6);
    expect(box.min.x + box.max.x).toBeCloseTo(0, 6);
    expect(box.min.z + box.max.z).toBeCloseTo(0, 6);
  });

  it('without a height still centres x/z and stands the model on the floor', () => {
    const group = new THREE.Group();
    group.add(makeBox([3, 3, 0], [2, 4, 2]));
    const box = normalizeGltf(group);
    expect(box.max.y - box.min.y).toBeCloseTo(4, 6);
    expect(box.min.y).toBeCloseTo(0, 6);
    expect(box.min.x + box.max.x).toBeCloseTo(0, 6);
  });
});

describe('clipTime', () => {
  it('loops the local time into the clip', () => {
    expect(clipTime(3.5, 2, { speed: 1, loop: true, offset: 0 })).toBeCloseTo(1.5, 6);
  });

  it('clamps just before the end when not looping', () => {
    expect(clipTime(3.5, 2, { speed: 1, loop: false, offset: 0 })).toBe(2 - HOLD_EPSILON);
  });

  it('applies speed before looping', () => {
    expect(clipTime(0.75, 2, { speed: 2, loop: true, offset: 0 })).toBeCloseTo(1.5, 6);
  });

  it('is 0 before the offset', () => {
    expect(clipTime(0.5, 2, { speed: 1, loop: true, offset: 1 })).toBe(0);
  });

  it('subtracts the offset before wrapping', () => {
    expect(clipTime(3, 2, { speed: 1, loop: true, offset: 2 })).toBeCloseTo(1, 6);
  });
});

describe('pickClip', () => {
  const clips = [
    { name: 'Idle', duration: 1 },
    { name: 'Wave', duration: 2 },
  ];

  it('returns the named clip', () => {
    const picked = pickClip(clips, 'Wave');
    expect(picked?.clip.name).toBe('Wave');
    expect(picked?.warning).toBeUndefined();
  });

  it('falls back to the first clip with a warning naming the missing clip', () => {
    const picked = pickClip(clips, 'Missing');
    expect(picked?.clip.name).toBe('Idle');
    expect(picked?.warning).toContain('Missing');
    expect(picked?.warning).toContain('Idle');
  });

  it('returns the first clip when no name is given', () => {
    const picked = pickClip(clips);
    expect(picked?.clip.name).toBe('Idle');
    expect(picked?.warning).toBeUndefined();
  });

  it('returns null for no clips', () => {
    expect(pickClip([], 'Wave')).toBeNull();
  });
});
