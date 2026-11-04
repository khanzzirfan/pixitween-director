import { describe, expect, it, vi } from 'vitest';
import type { MotionNode, NodeContext } from '../core/types';
import { LayerSchema } from '../schema';
import { createNode } from './createNode';

function context(): NodeContext {
  return { doc: { layers: [] } as never, textures: new Map(), renderer: null };
}

describe('createNode', () => {
  it('throws naming the type for a three layer with no factories.three', () => {
    const layer = LayerSchema.parse({
      id: 'r',
      type: 'three',
      width: 64,
      height: 64,
      objects: [{ id: 'b', geometry: { type: 'box', size: [1, 1, 1] } }],
    });
    expect(() => createNode(layer, context())).toThrow('motion: no node factory for three');
  });

  it('returns the node from a provided factories.three', () => {
    const layer = LayerSchema.parse({
      id: 'r',
      type: 'three',
      width: 64,
      height: 64,
      objects: [{ id: 'b', geometry: { type: 'box', size: [1, 1, 1] } }],
    });
    const fakeNode = {} as MotionNode;
    const three = vi.fn().mockReturnValue(fakeNode);
    const node = createNode(layer, context(), 0, { three });
    expect(node).toBe(fakeNode);
    expect(three).toHaveBeenCalledWith(layer, expect.anything(), 0);
  });

  it('dispatches an image layer without needing factories', () => {
    const layer = LayerSchema.parse({ id: 'a', type: 'image', asset: 'plate' });
    const node = createNode(layer, context());
    expect(node.layer).toBe(layer);
  });
});
