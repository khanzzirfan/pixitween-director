import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { NodeContext } from '../../core/types';
import { ShapeLayerSchema } from '../../schema/layers2d';
import { createShapeNode } from './shapeNode';

function context(): NodeContext {
  return { doc: { layers: [] } as never, textures: new Map(), renderer: null };
}

function boundingBox(geometry: THREE.BufferGeometry): THREE.Box3 {
  geometry.computeBoundingBox();
  return geometry.boundingBox!.clone();
}

function meshes(node: ReturnType<typeof createShapeNode>): THREE.Mesh[] {
  return node.content.children as THREE.Mesh[];
}

describe('createShapeNode', () => {
  it('builds a rect fill geometry spanning x 0..200, y -100..0', () => {
    const layer = ShapeLayerSchema.parse({ id: 'a', type: 'shape', shape: 'rect', width: 200, height: 100 });
    const node = createShapeNode(layer, context(), 0);
    const box = boundingBox(meshes(node)[0].geometry as THREE.BufferGeometry);
    expect(box.min.x).toBeCloseTo(0);
    expect(box.max.x).toBeCloseTo(200);
    expect(box.min.y).toBeCloseTo(-100);
    expect(box.max.y).toBeCloseTo(0);
  });

  it('clamps radius to half the smaller dimension', () => {
    const layer = ShapeLayerSchema.parse({ id: 'a', type: 'shape', shape: 'rect', width: 200, height: 100, radius: 80 });
    const node = createShapeNode(layer, context(), 0);
    // The clamped radius (50) still keeps the overall bounding box at 200x100.
    const box = boundingBox(meshes(node)[0].geometry as THREE.BufferGeometry);
    expect(box.max.x - box.min.x).toBeCloseTo(200);
    expect(box.max.y - box.min.y).toBeCloseTo(100);
  });

  it('builds an ellipse with a 200x100 bounding box centred at (100, -50)', () => {
    const layer = ShapeLayerSchema.parse({ id: 'a', type: 'shape', shape: 'ellipse', width: 200, height: 100 });
    const node = createShapeNode(layer, context(), 0);
    const box = boundingBox(meshes(node)[0].geometry as THREE.BufferGeometry);
    expect(box.max.x - box.min.x).toBeCloseTo(200);
    expect(box.max.y - box.min.y).toBeCloseTo(100);
    const center = new THREE.Vector3();
    box.getCenter(center);
    expect(center.x).toBeCloseTo(100);
    expect(center.y).toBeCloseTo(-50);
  });

  it('builds a stroke mesh whose bounding box equals the fill mesh', () => {
    const layer = ShapeLayerSchema.parse({
      id: 'a',
      type: 'shape',
      shape: 'rect',
      width: 200,
      height: 100,
      stroke: { color: '#000000', width: 4 },
    });
    const node = createShapeNode(layer, context(), 0);
    expect(meshes(node)).toHaveLength(2);
    const fillBox = boundingBox(meshes(node)[0].geometry as THREE.BufferGeometry);
    const strokeBox = boundingBox(meshes(node)[1].geometry as THREE.BufferGeometry);
    expect(strokeBox.min.x).toBeCloseTo(fillBox.min.x);
    expect(strokeBox.max.x).toBeCloseTo(fillBox.max.x);
    expect(strokeBox.min.y).toBeCloseTo(fillBox.min.y);
    expect(strokeBox.max.y).toBeCloseTo(fillBox.max.y);
  });

  it('builds a polystar whose box is the outer radius twice over and whose first point is at the top', () => {
    const layer = ShapeLayerSchema.parse({
      id: 'a',
      type: 'shape',
      shape: 'polystar',
      points: 16,
      outerRadius: 100,
      innerRadius: 43,
      starType: 'star',
    });
    const node = createShapeNode(layer, context(), 0);
    const mesh = meshes(node)[0];
    const box = boundingBox(mesh.geometry as THREE.BufferGeometry);

    expect(node.size()).toEqual({ width: 200, height: 200 });
    expect(box.min.x).toBeCloseTo(0);
    expect(box.max.x).toBeCloseTo(200);
    expect(box.min.y).toBeCloseTo(-200);
    expect(box.max.y).toBeCloseTo(0);

    // The star's first point is straight up, so a corner sits at the top of the box.
    const position = (mesh.geometry as THREE.BufferGeometry).attributes.position;
    const top = Array.from({ length: position.count }, (_, i) => ({
      x: position.getX(i),
      y: position.getY(i),
    })).some((point) => Math.abs(point.x - 100) < 1e-6 && Math.abs(point.y) < 1e-6);
    expect(top).toBe(true);
  });

  it('builds a polystar stroke as a ring around the same star', () => {
    const layer = ShapeLayerSchema.parse({
      id: 'a',
      type: 'shape',
      shape: 'polystar',
      points: 16,
      outerRadius: 100,
      innerRadius: 43,
      starType: 'star',
      stroke: { color: '#000000', width: 4 },
    });
    const node = createShapeNode(layer, context(), 0);
    expect(meshes(node)).toHaveLength(2);
    const fillBox = boundingBox(meshes(node)[0].geometry as THREE.BufferGeometry);
    const strokeBox = boundingBox(meshes(node)[1].geometry as THREE.BufferGeometry);
    expect(strokeBox.min.x).toBeCloseTo(fillBox.min.x);
    expect(strokeBox.max.x).toBeCloseTo(fillBox.max.x);
    expect(strokeBox.min.y).toBeCloseTo(fillBox.min.y);
    expect(strokeBox.max.y).toBeCloseTo(fillBox.max.y);
  });

  it('sets the fill material colour via resolveTarget and applies opacity to both materials', () => {
    const layer = ShapeLayerSchema.parse({
      id: 'a',
      type: 'shape',
      shape: 'rect',
      width: 200,
      height: 100,
      stroke: { color: '#000000', width: 4 },
    });
    const node = createShapeNode(layer, context(), 0);
    const [fillMesh, strokeMesh] = meshes(node);
    const fillMaterial = fillMesh.material as THREE.MeshBasicMaterial;
    const strokeMaterial = strokeMesh.material as THREE.MeshBasicMaterial;

    const target = node.resolveTarget(undefined, 'fill');
    expect(target).not.toBeNull();
    target!.setColor!('#00ff00');
    expect(`#${fillMaterial.color.getHexString()}`).toBe('#00ff00');

    node.applyOpacity(0.5);
    expect(fillMaterial.opacity).toBe(0.5);
    expect(strokeMaterial.opacity).toBe(0.5);
  });
});

describe('shape triangulation covers the full area', () => {
  it.each([
    [300, 200, 0],
    [700, 420, 0],
    [1920, 1080, 0],
    [700, 420, 24],
  ])('%ix%i radius %i', (width, height, radius) => {
    const layer = ShapeLayerSchema.parse({ id: 's', type: 'shape', shape: 'rect', width, height, radius });
    const node = createShapeNode(layer, { doc: { layers: [] } as never, textures: new Map(), renderer: null }, 0);
    const mesh = node.content.children[0] as THREE.Mesh;
    const pos = mesh.geometry.attributes.position;
    const index = mesh.geometry.index!.array;
    let area = 0;
    for (let i = 0; i < index.length; i += 3) {
      const [a, b, c] = [index[i], index[i + 1], index[i + 2]];
      area += Math.abs((pos.getX(b) - pos.getX(a)) * (pos.getY(c) - pos.getY(a)) - (pos.getX(c) - pos.getX(a)) * (pos.getY(b) - pos.getY(a))) / 2;
    }
    const expected = width * height - (radius > 0 ? (4 - Math.PI) * radius * radius : 0);
    expect(Math.abs(area - expected) / expected).toBeLessThan(0.01);
  });
});
