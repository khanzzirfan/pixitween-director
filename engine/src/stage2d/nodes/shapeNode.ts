import * as THREE from 'three';
import type { TargetRef } from '../../core/paths';
import { createLayerMaterial, type LayerMaterial } from '../../core/layerMaterial';
import { applyBaseTransform, createLayerObjects, resolveBaseTarget } from '../../core/transform';
import type { MotionNode, NodeFactory } from '../../core/types';
import type { ShapeLayer } from '../../schema';
import { insetPolystar, polystarCorners, type PolystarSpec } from '../polystar';

// shapeNode (engine/docs/03-stage-2d.md): a rect (rounded when `radius > 0`), an ellipse or a
// polystar (a star or a polygon), drawn as a `ShapeGeometry` spanning x 0..width, y -height..0
// (doc pixel space). The stroke, when present, is a second mesh shaped as a ring: the same outer
// outline with an inset copy of it carved out as a hole, so the stroke mesh's bounding box always
// equals the fill mesh's.

/** The star a polystar layer is drawn from. */
function polystarOf(layer: ShapeLayer): PolystarSpec {
  return {
    points: layer.points ?? 3,
    outerRadius: layer.outerRadius ?? 0,
    innerRadius: layer.innerRadius ?? layer.outerRadius ?? 0,
    starType: layer.starType ?? 'star',
  };
}

/** The size a shape layer is measured by: a rect or an ellipse states it, a polystar is twice its outer radius. */
export function shapeSize(layer: ShapeLayer): { width: number; height: number } {
  if (layer.shape === 'polystar') {
    const diameter = (layer.outerRadius ?? 0) * 2;
    return { width: layer.width ?? diameter, height: layer.height ?? diameter };
  }
  return { width: layer.width ?? 0, height: layer.height ?? 0 };
}

function appendOutline(
  path: THREE.Shape | THREE.Path,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  shape: ShapeLayer['shape'],
  polystar?: PolystarSpec
): void {
  if (shape === 'ellipse') {
    path.absellipse(x + width / 2, y + height / 2, width / 2, height / 2, 0, Math.PI * 2, false, 0);
    return;
  }
  if (shape === 'polystar' && polystar) {
    // The star's corners come in the doc's shape space (y down) and are flipped into the engine's
    // y-up geometry, so the first corner sits at the top of the shape's box.
    const cx = x + width / 2;
    const cy = y + height / 2;
    polystarCorners(polystar).forEach((corner, index) => {
      const px = cx + corner.x;
      const py = cy - corner.y;
      if (index === 0) path.moveTo(px, py);
      else path.lineTo(px, py);
    });
    path.closePath();
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
  const { width, height } = shapeSize(layer);
  const shape = new THREE.Shape();
  appendOutline(shape, 0, 0, width, height, layer.radius, layer.shape, layer.shape === 'polystar' ? polystarOf(layer) : undefined);
  const geometry = new THREE.ShapeGeometry(shape);
  geometry.translate(0, -height, 0);
  return geometry;
}

function buildStrokeGeometry(layer: ShapeLayer, strokeWidth: number): THREE.ShapeGeometry | null {
  const { width, height } = shapeSize(layer);
  const outer = new THREE.Shape();
  const polystar = layer.shape === 'polystar' ? polystarOf(layer) : undefined;
  appendOutline(outer, 0, 0, width, height, layer.radius, layer.shape, polystar);
  const hole = new THREE.Path();
  if (polystar) {
    // A star's stroke is the same star pulled in by the stroke's width.
    const inset = insetPolystar(polystar, strokeWidth);
    if (inset.outerRadius <= 0) return null; // the stroke is wider than the star
    appendOutline(hole, 0, 0, width, height, layer.radius, layer.shape, inset);
  } else {
    appendOutline(
      hole,
      strokeWidth,
      strokeWidth,
      width - 2 * strokeWidth,
      height - 2 * strokeWidth,
      Math.max(layer.radius - strokeWidth, 0),
      layer.shape
    );
  }
  outer.holes.push(hole);
  const geometry = new THREE.ShapeGeometry(outer);
  geometry.translate(0, -height, 0);
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
  const size = shapeSize(layer);

  const { display, content } = createLayerObjects(layer);

  const fillGeometry = buildFillGeometry(layer);
  const fill = createLayerMaterial({ blendMode: layer.blendMode, color: layer.fill });
  const fillMesh = new THREE.Mesh(fillGeometry, fill.material);
  fillMesh.name = `${layer.id}:fill`;
  content.add(fillMesh);

  let strokeGeometry: THREE.ShapeGeometry | null = null;
  let stroke: LayerMaterial | null = null;
  if (layer.stroke) {
    strokeGeometry = buildStrokeGeometry(layer, layer.stroke.width);
    if (strokeGeometry) {
      stroke = createLayerMaterial({ blendMode: layer.blendMode, color: layer.stroke.color });
      const strokeMesh = new THREE.Mesh(strokeGeometry, stroke.material);
      strokeMesh.name = `${layer.id}:stroke`;
      content.add(strokeMesh);
    }
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
      if (prop === 'fill') return colorTarget(fill.color);
      return resolveBaseTarget(node, prop);
    },

    applyOpacity(effective) {
      fill.setAlpha(effective);
      stroke?.setAlpha(effective);
    },

    setBackdrop(texture, stage) {
      fill.setBackdrop?.(texture, stage);
      stroke?.setBackdrop?.(texture, stage);
    },

    ready: Promise.resolve(),

    destroy() {
      fillGeometry.dispose();
      fill.dispose();
      strokeGeometry?.dispose();
      stroke?.dispose();
      display.removeFromParent();
    },
  };

  return node;
}
