import { describe, expect, it } from 'vitest';
import { pathRef } from './paths';

describe('pathRef', () => {
  it('resolves a nested path to the owning object and key', () => {
    const rotation = { y: 0 };
    const ref = pathRef({ rotation }, 'rotation.y', 'deg');
    expect(ref.obj).toBe(rotation);
    expect(ref.key).toBe('y');
    expect(ref.kind).toBe('deg');
  });

  it('resolves a top-level property on the root', () => {
    const root = { x: 1 };
    const ref = pathRef(root, 'x', 'number');
    expect(ref.obj).toBe(root);
    expect(ref.key).toBe('x');
  });

  it('throws naming the full path when a segment is missing', () => {
    expect(() => pathRef({}, 'a.b', 'number')).toThrowError('motion: no property "a.b"');
    expect(() => pathRef({ a: 5 }, 'a.b', 'number')).toThrowError('motion: no property "a.b"');
  });
});
