import { describe, expect, it } from 'vitest';
import { GroupLayerSchema, ImageLayerSchema, PolystarShapeSchema, ShapeLayerSchema, TextLayerSchema } from './layers2d';
import { LayerSchema } from './layer';

describe('ImageLayerSchema', () => {
  it('fills every base default and the tint', () => {
    const layer = ImageLayerSchema.parse({ id: 'a', type: 'image', asset: 'p' });
    expect(layer.start).toBe(0);
    expect(layer.x).toBe(0);
    expect(layer.y).toBe(0);
    expect(layer.anchor).toEqual([0.5, 0.5]);
    expect(layer.scale).toBe(1);
    expect(layer.rotation).toBe(0);
    expect(layer.alpha).toBe(1);
    expect(layer.blendMode).toBe('normal');
    expect(layer.effects).toEqual([]);
    expect(layer.tweens).toEqual([]);
    expect(layer.tint).toBe('#ffffff');
    expect(layer.end).toBeUndefined();
    expect(layer.pivot).toBeUndefined();
  });

  it('parses a pivot in pixels and rejects a pivot with three numbers', () => {
    const layer = ImageLayerSchema.parse({ id: 'a', type: 'image', asset: 'p', pivot: [0, 0] });
    expect(layer.pivot).toEqual([0, 0]);
    const bad = ImageLayerSchema.safeParse({ id: 'a', type: 'image', asset: 'p', pivot: [0, 0, 0] });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(bad.error.issues[0].path.at(-1)).toBe('pivot');
  });

  it('rejects an unknown key and a missing asset', () => {
    expect(ImageLayerSchema.safeParse({ id: 'a', type: 'image', asset: 'p', foo: 1 }).success).toBe(false);
    expect(ImageLayerSchema.safeParse({ id: 'a', type: 'image' }).success).toBe(false);
  });
});

describe('TextLayerSchema', () => {
  it('fills the style defaults from an empty style object', () => {
    const layer = TextLayerSchema.parse({ id: 't', type: 'text', text: 'hi', style: {} });
    expect(layer.style.fontSize).toBe(64);
    expect(layer.style.fill).toBe('#ffffff');
    expect(layer.style.align).toBe('left');
    expect(layer.style.fontFamily).toBe('Inter, Helvetica, Arial, sans-serif');
    expect(layer.style.fontWeight).toBe('400');
    expect(layer.style.fontStyle).toBe('normal');
    expect(layer.style.letterSpacing).toBe(0);
  });

  it('defaults the whole style object when it is omitted', () => {
    const layer = TextLayerSchema.parse({ id: 't', type: 'text', text: 'hi' });
    expect(layer.style.fontSize).toBe(64);
  });

  it('rejects fontSize 3, an unknown key and empty text', () => {
    expect(TextLayerSchema.safeParse({ id: 't', type: 'text', text: 'hi', style: { fontSize: 3 } }).success).toBe(false);
    expect(TextLayerSchema.safeParse({ id: 't', type: 'text', text: 'hi', foo: 1 }).success).toBe(false);
    expect(TextLayerSchema.safeParse({ id: 't', type: 'text', text: '' }).success).toBe(false);
  });
});

describe('ShapeLayerSchema', () => {
  it('fills the fill and radius defaults', () => {
    const layer = ShapeLayerSchema.parse({ id: 's', type: 'shape', shape: 'rect', width: 10, height: 10 });
    expect(layer.fill).toBe('#ffffff');
    expect(layer.radius).toBe(0);
    expect(layer.effects).toEqual([]);
  });

  it('rejects a negative radius, a bad shape and an unknown key', () => {
    expect(ShapeLayerSchema.safeParse({ id: 's', type: 'shape', shape: 'rect', width: 10, height: 10, radius: -1 }).success).toBe(false);
    expect(ShapeLayerSchema.safeParse({ id: 's', type: 'shape', shape: 'round', width: 10, height: 10 }).success).toBe(false);
    expect(ShapeLayerSchema.safeParse({ id: 's', type: 'shape', shape: 'rect', width: 10, height: 10, foo: 1 }).success).toBe(false);
  });

  it('takes a polystar: its points and its two radii', () => {
    const layer = ShapeLayerSchema.parse({
      id: 's',
      type: 'shape',
      shape: 'polystar',
      points: 16,
      outerRadius: 100,
      innerRadius: 43,
      starType: 'star',
    });
    expect(layer.shape).toBe('polystar');
    expect(layer.points).toBe(16);
    expect(layer.outerRadius).toBe(100);
    expect(layer.innerRadius).toBe(43);
    expect(layer.starType).toBe('star');
  });

  it('rejects a polystar with fewer than three points', () => {
    expect(
      ShapeLayerSchema.safeParse({ id: 's', type: 'shape', shape: 'polystar', points: 2, outerRadius: 100, innerRadius: 43, starType: 'star' })
        .success,
    ).toBe(false);
  });
});

describe('PolystarShapeSchema', () => {
  it('takes a star of 16 points', () => {
    const shape = PolystarShapeSchema.parse({ shape: 'polystar', points: 16, outerRadius: 100, innerRadius: 43, starType: 'star' });
    expect(shape.points).toBe(16);
    expect(shape.outerRadius).toBe(100);
    expect(shape.innerRadius).toBe(43);
    expect(shape.starType).toBe('star');
  });

  it('defaults to a star and takes a polygon', () => {
    expect(PolystarShapeSchema.parse({ shape: 'polystar', points: 6, outerRadius: 100 }).starType).toBe('star');
    expect(PolystarShapeSchema.parse({ shape: 'polystar', points: 6, outerRadius: 100, starType: 'polygon' }).starType).toBe('polygon');
  });

  it('rejects fewer than three points, a radius of zero and an unknown key', () => {
    expect(PolystarShapeSchema.safeParse({ shape: 'polystar', points: 2, outerRadius: 100, innerRadius: 43, starType: 'star' }).success).toBe(false);
    expect(PolystarShapeSchema.safeParse({ shape: 'polystar', points: 16, outerRadius: 0, innerRadius: 43, starType: 'star' }).success).toBe(false);
    expect(PolystarShapeSchema.safeParse({ shape: 'polystar', points: 16, outerRadius: 100, foo: 1 }).success).toBe(false);
  });
});

describe('GroupLayerSchema', () => {
  it('rejects an empty children array', () => {
    expect(GroupLayerSchema.safeParse({ id: 'g', type: 'group', children: [] }).success).toBe(false);
  });

  it('parses a shape child and fills its defaults', () => {
    const group = GroupLayerSchema.parse({
      id: 'g',
      type: 'group',
      children: [{ id: 'c', type: 'shape', shape: 'ellipse', width: 4, height: 4 }],
    });
    expect(group.children).toHaveLength(1);
    const child = group.children[0];
    expect(child.type).toBe('shape');
    if (child.type !== 'shape') throw new Error('expected a shape child');
    expect(child.fill).toBe('#ffffff');
    expect(child.radius).toBe(0);
    expect(child.blendMode).toBe('normal');
    expect(child.alpha).toBe(1);
    expect(child.effects).toEqual([]);
    expect(child.tweens).toEqual([]);
  });

  it('rejects an unknown key', () => {
    expect(
      GroupLayerSchema.safeParse({
        id: 'g',
        type: 'group',
        children: [{ id: 'c', type: 'shape', shape: 'rect', width: 1, height: 1 }],
        foo: 1,
      }).success,
    ).toBe(false);
  });
});

describe('LayerSchema', () => {
  it('discriminates on type and parses nested layers', () => {
    const image = LayerSchema.parse({ id: 'i', type: 'image', asset: 'a' });
    expect(image.type).toBe('image');
    const group = LayerSchema.parse({ id: 'g', type: 'group', children: [{ id: 'i2', type: 'image', asset: 'a' }] });
    expect(group.type).toBe('group');
    expect(LayerSchema.safeParse({ id: 'x', type: 'nope' }).success).toBe(false);
  });

  it('allows nested groups', () => {
    const outer = LayerSchema.parse({
      id: 'outer',
      type: 'group',
      children: [{ id: 'inner', type: 'group', children: [{ id: 'leaf', type: 'text', text: 'hi' }] }],
    });
    expect(outer.type).toBe('group');
  });

  it('takes soft-light as a blend mode and refuses an unknown one', () => {
    const shape = LayerSchema.parse({ id: 's', type: 'shape', shape: 'rect', width: 1, height: 1, blendMode: 'soft-light' });
    expect(shape.blendMode).toBe('soft-light');
    expect(LayerSchema.safeParse({ id: 's', type: 'shape', shape: 'rect', width: 1, height: 1, blendMode: 'overlay' }).success).toBe(false);
  });
});
