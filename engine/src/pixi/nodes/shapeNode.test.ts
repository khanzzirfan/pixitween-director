import { describe, expect, it } from 'vitest';
import { Graphics } from 'pixi.js';
import type { MotionDoc } from '../../schema';
import { ShapeLayerSchema } from '../../schema/layers2d';
import type { NodeContext } from '../../core/types';
import { createShapeNode } from './shapeNode';

function shapeLayer(overrides: Record<string, unknown> = {}) {
  return ShapeLayerSchema.parse({ id: 'a', type: 'shape', shape: 'rect', width: 200, height: 100, ...overrides });
}

function context(): NodeContext {
  return { doc: { layers: [] } as unknown as MotionDoc, textures: new Map(), app: null };
}

describe('createShapeNode', () => {
  it('places a rect with the anchor as pivot and reports its size', () => {
    const node = createShapeNode(shapeLayer({ x: 300, y: 200, anchor: [0.5, 0.5] }), context(), 0);

    expect(node.display).toBeInstanceOf(Graphics);
    expect(node.display.position.x).toBe(300);
    expect(node.display.position.y).toBe(200);
    expect(node.display.pivot.x).toBe(100);
    expect(node.display.pivot.y).toBe(50);
    expect(node.size()).toEqual({ width: 200, height: 100 });
    expect(node.children).toEqual([]);
  });

  it('resolves the fill as a colour target that reads back and redraws', () => {
    const node = createShapeNode(shapeLayer({ fill: '#00ff00' }), context(), 0);
    const ref = node.resolveTarget(undefined, 'fill');

    expect(ref?.kind).toBe('color');
    expect(ref?.getColor?.()).toBe('#00ff00');
    ref?.setColor?.('#ff0000');
    expect(ref?.getColor?.()).toBe('#ff0000');
  });

  it('returns null for a target it does not own', () => {
    const node = createShapeNode(shapeLayer(), context(), 0);
    expect(node.resolveTarget('camera', 'fov')).toBeNull();
    expect(node.resolveTarget(undefined, 'nope')).toBeNull();
  });

  it('routes the base transform properties through resolveBaseTarget', () => {
    const node = createShapeNode(shapeLayer(), context(), 0);
    expect(node.resolveTarget(undefined, 'x')?.obj).toBe(node.display);
    expect(node.resolveTarget(undefined, 'alpha')?.kind).toBe('number');
  });

  it('offsets start and end by parentStart', () => {
    const node = createShapeNode(shapeLayer({ start: 1, end: 3 }), context(), 2);
    expect(node.start).toBe(3);
    expect(node.end).toBe(5);
  });

  it('draws ellipses, rounded rects and strokes, and is ready at once', async () => {
    const variants: Array<Record<string, unknown>> = [
      { shape: 'ellipse' },
      { shape: 'rect', radius: 12 },
      { shape: 'rect', stroke: { color: '#000000', width: 4 } },
    ];
    for (const overrides of variants) {
      const node = createShapeNode(shapeLayer(overrides), context(), 0);
      expect(node.size()).toEqual({ width: 200, height: 100 });
      await expect(node.ready).resolves.toBeUndefined();
    }
  });
});
