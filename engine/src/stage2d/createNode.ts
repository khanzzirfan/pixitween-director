import type { MotionNode, NodeContext, NodeFactory } from '../core/types';
import type { Layer } from '../schema';
import { createGroupNode } from './nodes/groupNode';
import { createImageNode } from './nodes/imageNode';
import { createShapeNode } from './nodes/shapeNode';
import { createTextNode } from './nodes/textNode';

// createNode (engine/docs/03-stage-2d.md): dispatches a layer to its node builder by `type`. `image`,
// `text`, `shape` and `group` are built in; `three` is injected via `factories.three` (R1, the player
// owns the renderer) since stage2d itself cannot build a Three rig. Groups recurse into this same
// function for their children, passing their own absolute start as the children's `parentStart`.

export interface Factories {
  three?: NodeFactory;
}

export function createNode(layer: Layer, ctx: NodeContext, parentStart = 0, factories: Factories = {}): MotionNode {
  switch (layer.type) {
    case 'image':
      return createImageNode(layer, ctx, parentStart);
    case 'text':
      return createTextNode(layer, ctx, parentStart);
    case 'shape':
      return createShapeNode(layer, ctx, parentStart);
    case 'group':
      return createGroupNode(layer, ctx, parentStart, factories);
    case 'three':
      if (!factories.three) throw new Error('motion: no node factory for three');
      return factories.three(layer, ctx, parentStart);
    default: {
      const unreachable: never = layer;
      throw new Error(`motion: no node factory for ${(unreachable as Layer).type}`);
    }
  }
}
