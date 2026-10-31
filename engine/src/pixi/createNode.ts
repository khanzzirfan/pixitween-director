import type { MotionNode, NodeContext, NodeFactory } from '../core/types';
import type { Layer } from '../schema';
import { createGroupNode } from './nodes/groupNode';
import { createImageNode } from './nodes/imageNode';
import { createShapeNode } from './nodes/shapeNode';
import { createTextNode } from './nodes/textNode';

/** Factories the runtime supplies for layer types the 2D stage does not own (currently `three`). */
export type NodeFactories = Partial<Record<Layer['type'], NodeFactory>>;

const twoDFactories: Record<'image' | 'text' | 'shape', NodeFactory> = {
  image: createImageNode,
  text: createTextNode,
  shape: createShapeNode,
};

/**
 * Build the node for any layer. The four 2D types dispatch to their factories; a group recurses
 * through this same function (with the same `factories`) passing its own absolute start so nested
 * children are offset by every ancestor. `three` has no 2D factory: the runtime passes
 * `factories.three` (m4). A missing factory throws `motion: no node factory for <type>`.
 */
export function createNode(
  layer: Layer,
  ctx: NodeContext,
  parentStart = 0,
  factories?: NodeFactories,
): MotionNode {
  if (layer.type === 'group') {
    return createGroupNode(layer, ctx, parentStart, (child, childCtx, childStart) =>
      createNode(child, childCtx, childStart, factories),
    );
  }

  const factory = layer.type === 'three' ? factories?.three : twoDFactories[layer.type];

  if (factory === undefined) {
    throw new Error(`motion: no node factory for ${layer.type}`);
  }

  return factory(layer, ctx, parentStart);
}
