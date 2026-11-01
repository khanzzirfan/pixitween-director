import * as THREE from 'three';
import type { TargetRef } from '../../core/paths';
import { configure2DMaterial } from '../../core/stage';
import { applyBaseTransform, applyBlendMode, createLayerObjects, resolveBaseTarget } from '../../core/transform';
import type { MotionNode, NodeContext, NodeFactory } from '../../core/types';
import type { ImageLayer } from '../../schema';

// imageNode (engine/docs/03-stage-2d.md): a `Mesh(PlaneGeometry(w, h))` showing the layer's image
// texture, sized from the layer's `width`/`height` with the texture's aspect kept when one is missing
// (the natural size when neither is given). A missing texture never throws: the node stays an empty
// content group, size 0x0, and `ready` rejects with the asset id so the rest of the doc still plays.

function imageSize(texture: THREE.Texture, layer: ImageLayer): { width: number; height: number } {
  const image = texture.image as { width: number; height: number };
  const nw = image.width;
  const nh = image.height;
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

function colorTarget(color: THREE.Color): TargetRef {
  return {
    obj: color,
    key: 'color',
    kind: 'color',
    getColor: () => `#${color.getHexString()}`,
    setColor: (hex) => color.set(hex),
  };
}

export const createImageNode: NodeFactory = (layer, ctx, parentStart) => {
  if (layer.type !== 'image') {
    throw new Error(`motion: createImageNode expects an image layer, got ${layer.type}`);
  }
  return buildImageNode(layer, ctx, parentStart);
};

function buildImageNode(layer: ImageLayer, ctx: NodeContext, parentStart: number): MotionNode {
  const start = parentStart + layer.start;
  const end = parentStart + (layer.end ?? layer.start);
  const alpha = { value: layer.alpha };
  const warnings: string[] = [];

  const { display, content } = createLayerObjects(layer);

  const texture = ctx.textures.get(layer.asset);
  let size = { width: 0, height: 0 };
  let material: THREE.MeshBasicMaterial | null = null;
  let geometry: THREE.PlaneGeometry | null = null;
  let ready: Promise<void>;

  if (texture === undefined) {
    ready = Promise.reject(new Error(`motion: image asset ${layer.asset} did not load`));
  } else {
    size = imageSize(texture, layer);
    geometry = new THREE.PlaneGeometry(size.width, size.height);
    geometry.translate(size.width / 2, -size.height / 2, 0);
    material = new THREE.MeshBasicMaterial({ map: texture, color: layer.tint });
    configure2DMaterial(material);
    applyBlendMode(material, layer.blendMode);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `${layer.id}:plane`;
    content.add(mesh);
    ready = Promise.resolve();
  }
  ready.catch(() => {});

  applyBaseTransform(display, content, layer, size);

  const node: MotionNode = {
    id: layer.id,
    layer,
    display,
    content,
    start,
    end,
    children: [],
    alpha,
    warnings,

    size: () => size,

    resolveTarget(target, prop) {
      if (target !== undefined) return null;
      if (prop === 'tint') return material ? colorTarget(material.color) : null;
      return resolveBaseTarget(node, prop);
    },

    applyOpacity(effective) {
      if (material) material.opacity = effective;
    },

    ready,

    destroy() {
      geometry?.dispose();
      material?.dispose();
      display.removeFromParent();
    },
  };

  return node;
}
