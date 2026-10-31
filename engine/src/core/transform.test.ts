import { describe, expect, it } from 'vitest';
import { Container } from 'pixi.js';
import { ShapeLayerSchema } from '../schema/layers2d';
import { applyBaseTransform, resolveBaseTarget } from './transform';

function shapeLayer(overrides: Record<string, unknown> = {}) {
  return ShapeLayerSchema.parse({ id: 'a', type: 'shape', shape: 'rect', width: 40, height: 20, ...overrides });
}

describe('applyBaseTransform', () => {
  it('writes position, rotation in radians, scale, anchor-as-pivot and alpha', () => {
    const display = new Container();
    applyBaseTransform(
      display,
      shapeLayer({ x: 100, y: 50, rotation: 90, scale: [2, 3], anchor: [0.5, 1], alpha: 0.5 }),
      { width: 40, height: 20 },
    );

    expect(display.position.x).toBe(100);
    expect(display.position.y).toBe(50);
    expect(display.rotation).toBeCloseTo(Math.PI / 2, 12);
    expect(display.scale.x).toBe(2);
    expect(display.scale.y).toBe(3);
    expect(display.pivot.x).toBe(20);
    expect(display.pivot.y).toBe(20);
    expect(display.alpha).toBe(0.5);
  });

  it('accepts a uniform scale number', () => {
    const display = new Container();
    applyBaseTransform(display, shapeLayer({ scale: 2 }), { width: 40, height: 20 });
    expect(display.scale.x).toBe(2);
    expect(display.scale.y).toBe(2);
  });

  it('maps the four blend modes to Pixi strings', () => {
    for (const [mode, expected] of [
      ['normal', 'normal'],
      ['add', 'add'],
      ['multiply', 'multiply'],
      ['screen', 'screen'],
    ] as const) {
      const display = new Container();
      applyBaseTransform(display, shapeLayer({ blendMode: mode }), { width: 40, height: 20 });
      expect(display.blendMode).toBe(expected);
    }
  });
});

describe('resolveBaseTarget', () => {
  it('returns null for a property that is not allowlisted', () => {
    expect(resolveBaseTarget(new Container(), 'width')).toBeNull();
    expect(resolveBaseTarget(new Container(), 'nope')).toBeNull();
  });

  it('targets x, y and alpha on the display', () => {
    const display = new Container();
    for (const prop of ['x', 'y', 'alpha'] as const) {
      const ref = resolveBaseTarget(display, prop);
      expect(ref?.obj).toBe(display);
      expect(ref?.key).toBe(prop);
      expect(ref?.kind).toBe('number');
    }
  });

  it('targets rotation as degrees on the display', () => {
    const display = new Container();
    const ref = resolveBaseTarget(display, 'rotation');
    expect(ref?.obj).toBe(display);
    expect(ref?.key).toBe('rotation');
    expect(ref?.kind).toBe('deg');
  });

  it('targets skewX and skewY on display.skew', () => {
    const display = new Container();
    expect(resolveBaseTarget(display, 'skewX')?.obj).toBe(display.skew);
    expect(resolveBaseTarget(display, 'skewX')?.key).toBe('x');
    expect(resolveBaseTarget(display, 'skewX')?.kind).toBe('deg');
    expect(resolveBaseTarget(display, 'skewY')?.obj).toBe(display.skew);
    expect(resolveBaseTarget(display, 'skewY')?.key).toBe('y');
  });

  it('targets scaleX and scaleY on display.scale', () => {
    const display = new Container();
    expect(resolveBaseTarget(display, 'scaleX')?.obj).toBe(display.scale);
    expect(resolveBaseTarget(display, 'scaleX')?.key).toBe('x');
    expect(resolveBaseTarget(display, 'scaleY')?.obj).toBe(display.scale);
    expect(resolveBaseTarget(display, 'scaleY')?.key).toBe('y');
  });

  it('scale writes both axes and reads scale.x', () => {
    const display = new Container();
    const ref = resolveBaseTarget(display, 'scale');
    if (!ref) throw new Error('expected a scale ref');
    const proxy = ref.obj as { scale: number };
    proxy.scale = 4;
    expect(display.scale.x).toBe(4);
    expect(display.scale.y).toBe(4);
    expect(proxy.scale).toBe(4);
  });

  it('gives every scale call on one display the same proxy object', () => {
    const display = new Container();
    expect(resolveBaseTarget(display, 'scale')?.obj).toBe(resolveBaseTarget(display, 'scale')?.obj);
  });
});
