import { applyBaseTransform, createLayerObjects, resolveBaseTarget } from '../../core/transform';
import type { MotionNode, NodeContext } from '../../core/types';
import type { GroupLayer } from '../../schema';
import { createNode, type Factories } from '../createNode';

// groupNode (engine/docs/03-stage-2d.md): a `Group` holding its children's displays in order, with no
// meshes of its own. Children are built through `createNode` with the group's own absolute start as
// their `parentStart`, so start times nest (a child starting at 1 inside a group starting at 2 starts
// at 3). Size is the union of the children's bounds, in the children's local (post-transform) space.

export function createGroupNode(layer: GroupLayer, ctx: NodeContext, parentStart: number, factories: Factories): MotionNode {
  const start = parentStart + layer.start;
  const end = parentStart + (layer.end ?? layer.start);
  const alpha = { value: layer.alpha };
  const warnings: string[] = [];

  const { display, content } = createLayerObjects(layer);

  const children = layer.children.map((child) => createNode(child, ctx, start, factories));
  for (const child of children) {
    content.add(child.display);
    warnings.push(...child.warnings);
  }

  const size = (): { width: number; height: number } => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const child of children) {
      const { width, height } = child.size();
      const x = child.display.position.x;
      const y = child.display.position.y;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x + width);
      minY = Math.min(minY, y - height);
      maxY = Math.max(maxY, y);
    }
    if (minX === Infinity) return { width: 0, height: 0 };
    return { width: maxX - minX, height: maxY - minY };
  };

  applyBaseTransform(display, content, layer, size());

  const ready = Promise.all(children.map((child) => child.ready)).then(() => undefined);
  ready.catch(() => {});

  const node: MotionNode = {
    id: layer.id,
    layer,
    display,
    content,
    start,
    end,
    children,
    alpha,
    warnings,

    size,

    resolveTarget(target, prop) {
      if (target !== undefined) return null;
      return resolveBaseTarget(node, prop);
    },

    applyOpacity() {},

    ready,

    destroy() {
      for (const child of children) child.destroy();
      display.removeFromParent();
    },
  };

  return node;
}
