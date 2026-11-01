import { describe, expect, it, vi } from 'vitest';
import type { NodeContext } from '../../core/types';
import { GroupLayerSchema } from '../../schema/layers2d';
import { createGroupNode } from './groupNode';

function context(): NodeContext {
  return { doc: { layers: [] } as never, textures: new Map(), renderer: null };
}

describe('createGroupNode', () => {
  it('offsets a child start by the group start, nesting across grandchildren', () => {
    const layer = GroupLayerSchema.parse({
      id: 'g',
      type: 'group',
      start: 2,
      children: [
        {
          id: 'child',
          type: 'group',
          start: 1,
          children: [
            { id: 'grandchild', type: 'shape', shape: 'rect', width: 10, height: 10, start: 0.5 },
          ],
        },
      ],
    });
    const group = createGroupNode(layer, context(), 0, {});
    expect(group.start).toBe(2);
    const child = group.children[0];
    expect(child.start).toBe(3);
    const grandchild = child.children[0];
    expect(grandchild.start).toBe(3.5);
  });

  it('sizes to the union of its children bounds', () => {
    const layer = GroupLayerSchema.parse({
      id: 'g',
      type: 'group',
      children: [
        { id: 'a', type: 'shape', shape: 'rect', width: 100, height: 50, anchor: [0, 0], x: 0, y: 0 },
        { id: 'b', type: 'shape', shape: 'rect', width: 80, height: 40, anchor: [0, 0], x: 50, y: 30 },
      ],
    });
    const group = createGroupNode(layer, context(), 0, {});
    expect(group.size()).toEqual({ width: 130, height: 70 });
  });

  it('resolveTarget only allows base props, no extra targets', () => {
    const layer = GroupLayerSchema.parse({ id: 'g', type: 'group', children: [{ id: 'a', type: 'shape', shape: 'rect', width: 10, height: 10 }] });
    const group = createGroupNode(layer, context(), 0, {});
    expect(group.resolveTarget(undefined, 'alpha')).not.toBeNull();
    expect(group.resolveTarget(undefined, 'fill')).toBeNull();
    expect(group.resolveTarget('child', 'alpha')).toBeNull();
  });

  it('destroy calls destroy on every child node', () => {
    const layer = GroupLayerSchema.parse({
      id: 'g',
      type: 'group',
      children: [
        { id: 'a', type: 'shape', shape: 'rect', width: 10, height: 10 },
        { id: 'b', type: 'shape', shape: 'rect', width: 10, height: 10 },
      ],
    });
    const group = createGroupNode(layer, context(), 0, {});
    const destroySpies = group.children.map((child) => vi.spyOn(child, 'destroy'));
    group.destroy();
    for (const spy of destroySpies) expect(spy).toHaveBeenCalledTimes(1);
  });
});
