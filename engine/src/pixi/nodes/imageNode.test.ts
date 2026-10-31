import { describe, expect, it } from 'vitest';
import { Container, Sprite, Texture, TextureSource } from 'pixi.js';
import type { Texture as PixiTexture } from 'pixi.js';
import type { MotionDoc } from '../../schema';
import { ImageLayerSchema } from '../../schema/layers2d';
import type { NodeContext } from '../../core/types';
import { createImageNode } from './imageNode';

function imageLayer(overrides: Record<string, unknown> = {}) {
  return ImageLayerSchema.parse({ id: 'a', type: 'image', asset: 'p', ...overrides });
}

function context(texture?: PixiTexture, key = 'p'): NodeContext {
  const textures = texture === undefined ? new Map() : new Map([[key, texture]]);
  return { doc: { layers: [] } as unknown as MotionDoc, textures, app: null };
}

/** A 400 x 200 texture (2:1) from a canvas-free source. */
function plate(): PixiTexture {
  return new Texture({ source: new TextureSource({ width: 400, height: 200 }) });
}

describe('createImageNode', () => {
  it('sizes the sprite from width, height or neither with the aspect kept', () => {
    const byWidth = createImageNode(imageLayer({ width: 200 }), context(plate()), 0);
    expect(byWidth.display).toBeInstanceOf(Sprite);
    expect(byWidth.size()).toEqual({ width: 200, height: 100 });

    const byHeight = createImageNode(imageLayer({ height: 50 }), context(plate()), 0);
    expect(byHeight.size()).toEqual({ width: 100, height: 50 });

    const natural = createImageNode(imageLayer(), context(plate()), 0);
    expect(natural.size()).toEqual({ width: 400, height: 200 });
  });

  it('places the sprite with the anchor as pivot like the other nodes', () => {
    const node = createImageNode(imageLayer({ x: 300, y: 200, anchor: [0.5, 0.5], width: 200 }), context(plate()), 0);
    expect(node.display.position.x).toBe(300);
    expect(node.display.position.y).toBe(200);
    expect(node.display.pivot.x).toBe(100);
    expect(node.display.pivot.y).toBe(50);
  });

  it('resolves tint as a colour target that changes the sprite', () => {
    const node = createImageNode(imageLayer({ tint: '#00ff00' }), context(plate()), 0);
    const ref = node.resolveTarget(undefined, 'tint');

    expect(ref?.kind).toBe('color');
    expect(ref?.getColor?.()).toBe('#00ff00');
    ref?.setColor?.('#ff0000');
    expect(ref?.getColor?.()).toBe('#ff0000');
    expect((node.display as Sprite).tint).toBe(0xff0000);
  });

  it('routes the base transform properties through resolveBaseTarget and rejects foreign targets', () => {
    const node = createImageNode(imageLayer(), context(plate()), 0);
    expect(node.resolveTarget(undefined, 'x')?.obj).toBe(node.display);
    expect(node.resolveTarget(undefined, 'alpha')?.kind).toBe('number');
    expect(node.resolveTarget('camera', 'fov')).toBeNull();
    expect(node.resolveTarget(undefined, 'nope')).toBeNull();
  });

  it('offsets start and end by parentStart', () => {
    const node = createImageNode(imageLayer({ start: 1, end: 3 }), context(plate()), 2);
    expect(node.start).toBe(3);
    expect(node.end).toBe(5);
  });

  it('rejects ready with the asset id and never throws when the texture is missing', async () => {
    const node = createImageNode(imageLayer({ asset: 'gone' }), context(plate(), 'p'), 0);

    expect(node.display).toBeInstanceOf(Container);
    expect(node.size()).toEqual({ width: 0, height: 0 });
    expect(node.resolveTarget(undefined, 'tint')).toBeNull();
    expect(node.ready).rejects.toThrow(/image asset gone/);
  });
});
