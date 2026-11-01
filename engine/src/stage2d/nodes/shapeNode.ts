import * as THREE from 'three';
import type { TargetRef } from '../../core/paths';
import { configure2DMaterial } from '../../core/stage';
import { applyBaseTransform, applyBlendMode, createLayerObjects, resolveBaseTarget } from '../../core/transform';
import type { MotionNode, NodeFactory } from '../../core/types';
import type { ShapeLayer } from '../../schema';

// shapeNode (engine/docs/03-stage-2d.md): a rect (rounded when `radius > 0`) or an ellipse, drawn as a
// `ShapeGeometry` spanning x 0..width, y -height..0 (doc pixel space). The stroke, when present, is a
// second mesh shaped as a ring: the same outer outline with an inset copy of it carved out as a hole,
// so the stroke mesh's bounding box always equals the fill mesh's.

function appendOutline(
  path: THREE.Shape | THREE.Path,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  shape: ShapeLayer['shape']
): void {
  if (shape === 'ellipse') {
    path.absellipse(x + width / 2, y + height / 2, width / 2, height / 2, 0, Math.PI * 2, false, 0);
    return;
  }
  const r = Math.min(radius, width / 2, height / 2);
  if (r <= 0) {
    // Plain corners: zero-radius curves add duplicate points that make the triangulation drop a
    // triangle at some sizes (a 700x420 rect came out as half its area).
    path.moveTo(x, y);
    path.lineTo(x + width, y);
    path.lineTo(x + width, y + height);
    path.lineTo(x, y + height);
    path.lineTo(x, y);
    return;
  }
  path.moveTo(x + r, y);
  path.lineTo(x + width - r, y);
  path.quadraticCurveTo(x + width, y, x + width, y + r);
  path.lineTo(x + width, y + height - r);
  path.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  path.lineTo(x + r, y + height);
  path.quadraticCurveTo(x, y + height, x, y + height - r);
  path.lineTo(x, y + r);
  path.quadraticCurveTo(x, y, x + r, y);
}

function buildFillGeometry(layer: ShapeLayer): THREE.ShapeGeometry {
  const shape = new THREE.Shape();
  appendOutline(shape, 0, 0, layer.width, layer.height, layer.radius, layer.shape);
  const geometry = new THREE.ShapeGeometry(shape);
  geometry.translate(0, -layer.height, 0);
  return geometry;
}

function buildStrokeGeometry(layer: ShapeLayer, strokeWidth: number): THREE.ShapeGeometry {
  const outer = new THREE.Shape();
  appendOutline(outer, 0, 0, layer.width, layer.height, layer.radius, layer.shape);
  const hole = new THREE.Path();
  appendOutline(
    hole,
    strokeWidth,
    strokeWidth,
    layer.width - 2 * strokeWidth,
    layer.height - 2 * strokeWidth,
    Math.max(layer.radius - strokeWidth, 0),
    layer.shape
  );
  outer.holes.push(hole);
  const geometry = new THREE.ShapeGeometry(outer);
  geometry.translate(0, -layer.height, 0);
  return geometry;
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

export const createShapeNode: NodeFactory = (layer, _ctx, parentStart) => {
  if (layer.type !== 'shape') {
    throw new Error(`motion: createShapeNode expects a shape layer, got ${layer.type}`);
  }
  return buildShapeNode(layer, parentStart);
};

function buildShapeNode(layer: ShapeLayer, parentStart: number): MotionNode {
  const start = parentStart + layer.start;
  const end = parentStart + (layer.end ?? layer.start);
  const alpha = { value: layer.alpha };
  const size = { width: layer.width, height: layer.height };

  const { display, content } = createLayerObjects(layer);

  const fillGeometry = buildFillGeometry(layer);
  const fillMaterial = new THREE.MeshBasicMaterial({ color: layer.fill });
  configure2DMaterial(fillMaterial);
  applyBlendMode(fillMaterial, layer.blendMode);
  const fillMesh = new THREE.Mesh(fillGeometry, fillMaterial);
  fillMesh.name = `${layer.id}:fill`;
  content.add(fillMesh);

  let strokeGeometry: THREE.ShapeGeometry | null = null;
  let strokeMaterial: THREE.MeshBasicMaterial | null = null;
  if (layer.stroke) {
    strokeGeometry = buildStrokeGeometry(layer, layer.stroke.width);
    strokeMaterial = new THREE.MeshBasicMaterial({ color: layer.stroke.color });
    configure2DMaterial(strokeMaterial);
    applyBlendMode(strokeMaterial, layer.blendMode);
    const strokeMesh = new THREE.Mesh(strokeGeometry, strokeMaterial);
    strokeMesh.name = `${layer.id}:stroke`;
    content.add(strokeMesh);
  }

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
    warnings: [],

    size: () => size,

    resolveTarget(target, prop) {
      if (target !== undefined) return null;
      if (prop === 'fill') return colorTarget(fillMaterial.color);
      return resolveBaseTarget(node, prop);
    },

    applyOpacity(effective) {
      fillMaterial.opacity = effective;
      if (strokeMaterial) strokeMaterial.opacity = effective;
    },

    ready: Promise.resolve(),

    destroy() {
      fillGeometry.dispose();
      fillMaterial.dispose();
      strokeGeometry?.dispose();
      strokeMaterial?.dispose();
      display.removeFromParent();
    },
  };

  return node;
}
