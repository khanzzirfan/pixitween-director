import { Container, Sprite } from 'pixi.js';
import type { TargetRef } from '../../core/paths';
import { applyBaseTransform, resolveBaseTarget } from '../../core/transform';
import type { NodeFactory } from '../../core/types';
import type { ImageLayer } from '../../schema';

/**
 * The sprite dimensions for a layer against a `texture`: the layer's `width`/`height` when given,
 * the texture's natural size otherwise, with the aspect kept when only one is given.
 */
function imageSize(texture: { width: number; height: number }, layer: ImageLayer): { width: number; height: number } {
  const { width: nw, height: nh } = texture;
  if (layer.width !== undefined && layer.height !== undefined) {
    return { width: layer.width, height: layer.height };
  }
  if (layer.width !== undefined) {
    return { width: layer.width, height: nh * (layer.width / nw) };
  }
  if (layer.height !== undefined) {
    return { width: nw * (layer.height / nh), height: layer.height };
  }
  return { width: nw, height: nh };
}

/**
 * A `Sprite` showing the layer's image texture. The sprite is sized from the layer's `width`/`height`
 * with the texture's aspect kept when one is missing (the natural size when neither is given), so
 * plates and cut-outs drop in correctly; the `tint` target recolors the sprite on every write.
 *
 * A missing texture gives an empty `Container` whose `ready` rejects with the asset id, so the rest
 * of the doc still plays. The factory never throws.
 */
export const createImageNode: NodeFactory = (layer, ctx, parentStart) => {
  if (layer.type !== 'image') {
    throw new Error(`motion: createImageNode expects an image layer, got ${layer.type}`);
  }

  const texture = ctx.textures.get(layer.asset);

  if (texture === undefined) {
    const display = new Container();
    applyBaseTransform(display, layer, { width: 0, height: 0 });
    return {
      id: layer.id,
      layer,
      display,
      start: parentStart + layer.start,
      end: parentStart + (layer.end ?? layer.start),
      children: [],
      size: () => ({ width: 0, height: 0 }),
      resolveTarget(target, prop) {
        if (target === undefined) {
          if (prop === 'tint') return null;
          return resolveBaseTarget(display, prop);
        }
        return null;
      },
      ready: Promise.reject(new Error(`motion: image asset ${layer.asset} did not load`)),
      destroy() {
        display.destroy();
      },
    };
  }

  const sprite = new Sprite(texture);
  sprite.tint = layer.tint;
  const size = imageSize(texture, layer);
  applyBaseTransform(sprite, layer, size);

  // Both dimensions are written so the aspect is kept when only one is given; setting one axis in
  // Pixi scales only that axis, leaving the other at the natural size.
  sprite.width = size.width;
  sprite.height = size.height;

  let currentTint = layer.tint;
  const tintTarget: TargetRef = {
    obj: sprite,
    key: 'tint',
    kind: 'color',
    getColor: () => currentTint,
    setColor: (hex) => {
      currentTint = hex;
      sprite.tint = hex;
    },
  };

  return {
    id: layer.id,
    layer,
    display: sprite,
    start: parentStart + layer.start,
    end: parentStart + (layer.end ?? layer.start),
    children: [],
    size: () => ({ width: sprite.width, height: sprite.height }),
    resolveTarget(target, prop) {
      if (target !== undefined) return null;
      if (prop === 'tint') return tintTarget;
      return resolveBaseTarget(sprite, prop);
    },
    ready: Promise.resolve(),
    destroy() {
      sprite.destroy();
    },
  };
};
