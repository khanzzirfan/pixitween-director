import { describe, expect, it } from 'vitest';
import { createLayerObjects } from '../core/transform';
import { pickNode } from './pick';

function box(id: string, x: number, y: number) {
  const { display, content } = createLayerObjects({ id });
  display.position.set(x, -y, 0);
  return { id, display, content, size: () => ({ width: 100, height: 100 }) };
}

describe('pickNode', () => {
  it('returns the front node inside both, null outside', () => {
    const a = box('a', 0, 0);
    const b = box('b', 50, 50);
    const nodes = [a, b];
    expect(pickNode(nodes, 75, 75)).toBe('b');
    expect(pickNode(nodes, 10, 10)).toBe('a');
    expect(pickNode(nodes, 300, 300)).toBeNull();
  });

  it('never hits a hidden node', () => {
    const a = box('a', 0, 0);
    const b = box('b', 50, 50);
    b.display.visible = false;
    expect(pickNode([a, b], 75, 75)).toBe('a');
    a.display.visible = false;
    expect(pickNode([a, b], 75, 75)).toBeNull();
  });
});
