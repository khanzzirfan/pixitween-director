import { Container } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';
import type { MotionNode, NodeContext, NodeFactory } from '../core/types';
import type { Layer, MotionDoc } from '../schema';
import { ThreeLayerSchema } from '../schema/layer3d';
import { GroupLayerSchema } from '../schema/layers2d';
import { createNode } from './createNode';
import { createGroupNode } from './nodes/groupNode';

function context(): NodeContext {
  return { doc: { layers: [] } as unknown as MotionDoc, textures: new Map(), app: null };
}

function fakeNode(): MotionNode {
  return {
    id: 'fake',
    layer: { type: 'shape' } as Layer,
    display: new Container(),
    start: 0,
    end: 0,
    children: [],
    size: () => ({ width: 0, height: 0 }),
    resolveTarget: () => null,
    ready: Promise.resolve(),
    destroy: vi.fn(),
  };
}

const nestedGroup = GroupLayerSchema.parse({
  id: 'g',
  type: 'group',
  start: 2,
  children: [
    { id: 's', type: 'shape', shape: 'rect', width: 10, height: 10, start: 1 },
    {
      id: 'ng',
      type: 'group',
      start: 1,
      children: [{ id: 'gs', type: 'shape', shape: 'rect', width: 10, height: 10, start: 0.5 }],
    },
  ],
});

describe('createNode', () => {
  it('offsets a nested group start by every ancestor', () => {
    const group = createNode(nestedGroup, context(), 0);
    expect(group.start).toBe(2);

    const [shape, nested] = group.children;
    expect(shape.start).toBe(3);
    expect(nested.start).toBe(3);
    expect(nested.children[0].start).toBe(3.5);
  });

  it("adds the children's displays to the group display in layer order", () => {
    const group = createNode(nestedGroup, context(), 0);
    expect(group.display.children).toHaveLength(2);
    expect(group.display.children[0]).toBe(group.children[0].display);
    expect(group.display.children[1]).toBe(group.children[1].display);
  });

  it('throws naming three when no three factory is given', () => {
    const three = ThreeLayerSchema.parse({
      id: 't',
      type: 'three',
      width: 100,
      height: 100,
      objects: [{ id: 'o', geometry: { type: 'box', size: [1, 1, 1] } }],
    });

    expect(() => createNode(three, context(), 0)).toThrow('motion: no node factory for three');
  });

  it('returns the node from a supplied three factory', () => {
    const three = ThreeLayerSchema.parse({
      id: 't',
      type: 'three',
      width: 100,
      height: 100,
      objects: [{ id: 'o', geometry: { type: 'box', size: [1, 1, 1] } }],
    });
    const node = fakeNode();
    const three_factory: NodeFactory = () => node;

    expect(createNode(three, context(), 0, { three: three_factory })).toBe(node);
  });

  it('destroys every child node when the group is destroyed', () => {
    const a = fakeNode();
    const b = fakeNode();
    let i = 0;
    const nodes = [a, b];
    const create: NodeFactory = () => nodes[i++];

    const group = createGroupNode(nestedGroup, context(), 0, create);
    group.destroy();

    expect(a.destroy).toHaveBeenCalledTimes(1);
    expect(b.destroy).toHaveBeenCalledTimes(1);
  });
});
