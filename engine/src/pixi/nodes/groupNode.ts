import { Container } from 'pixi.js';
import { applyBaseTransform, resolveBaseTarget } from '../../core/transform';
import type { MotionNode, NodeContext, NodeFactory } from '../../core/types';
import type { GroupLayer } from '../../schema';

/**
 * A `Container` holding its children's displays in layer order. Children are built through the shared
 * `create` (so a nested group recurses), each with this group's absolute start as its `parentStart`, so
 * a child's `start` is already offset by every ancestor. `size()` is the union of the children's local
 * bounds; `ready` waits on every child and rejects if any does; `destroy` destroys every child node,
 * then the container.
 */
export const createGroupNode = (
  layer: GroupLayer,
  ctx: NodeContext,
  parentStart: number,
  create: NodeFactory,
): MotionNode => {
  const display = new Container();
  applyBaseTransform(display, layer, { width: 0, height: 0 });

  const absoluteStart = parentStart + layer.start;
  const children = layer.children.map((child) => {
    const node = create(child, ctx, absoluteStart);
    display.addChild(node.display);
    return node;
  });

  return {
    id: layer.id,
    layer,
    display,
    start: absoluteStart,
    end: parentStart + (layer.end ?? layer.start),
    children,
    size() {
      if (children.length === 0) return { width: 0, height: 0 };
      const bounds = display.getLocalBounds();
      return { width: bounds.width, height: bounds.height };
    },
    resolveTarget(target, prop) {
      if (target !== undefined) return null;
      return resolveBaseTarget(display, prop);
    },
    ready: Promise.all(children.map((child) => child.ready)).then(() => undefined),
    destroy() {
      for (const child of children) child.destroy();
      display.destroy({ children: true });
    },
  };
};
