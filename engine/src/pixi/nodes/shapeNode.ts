import { Graphics } from 'pixi.js';
import type { TargetRef } from '../../core/paths';
import { applyBaseTransform, resolveBaseTarget } from '../../core/transform';
import type { NodeFactory } from '../../core/types';
import type { ShapeLayer } from '../../schema';

/** Paint a rect (rounded when `radius > 0`) or an ellipse inside the `width x height` box at (0, 0). */
function paint(graphics: Graphics, layer: ShapeLayer, fill: string): void {
  graphics.clear();

  if (layer.shape === 'ellipse') {
    const rx = layer.width / 2;
    const ry = layer.height / 2;
    graphics.ellipse(rx, ry, rx, ry);
  } else if (layer.radius > 0) {
    graphics.roundRect(0, 0, layer.width, layer.height, layer.radius);
  } else {
    graphics.rect(0, 0, layer.width, layer.height);
  }

  graphics.fill(fill);
  if (layer.stroke) {
    graphics.stroke({ color: layer.stroke.color, width: layer.stroke.width });
  }
}

/**
 * A rect or ellipse drawn with `Graphics`. `size()` is the layer's `width x height`; the `fill`
 * target redraws the graphic on every colour write, and `ready` resolves at once (nothing to load).
 */
export const createShapeNode: NodeFactory = (layer, _ctx, parentStart) => {
  if (layer.type !== 'shape') {
    throw new Error(`motion: createShapeNode expects a shape layer, got ${layer.type}`);
  }

  const display = new Graphics();
  const size = { width: layer.width, height: layer.height };
  const state = { fill: layer.fill };

  paint(display, layer, state.fill);
  applyBaseTransform(display, layer, size);

  const fillTarget: TargetRef = {
    obj: state,
    key: 'fill',
    kind: 'color',
    getColor: () => state.fill,
    setColor: (hex) => {
      state.fill = hex;
      paint(display, layer, state.fill);
    },
  };

  return {
    id: layer.id,
    layer,
    display,
    start: parentStart + layer.start,
    end: parentStart + (layer.end ?? layer.start),
    children: [],
    size: () => ({ width: size.width, height: size.height }),
    resolveTarget(target, prop) {
      if (target !== undefined) return null;
      if (prop === 'fill') return fillTarget;
      return resolveBaseTarget(display, prop);
    },
    ready: Promise.resolve(),
    destroy() {
      display.destroy();
    },
  };
};
