import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { NodeContext } from '../../core/types';
import { ImageLayerSchema } from '../../schema/layers2d';
import { createImageNode } from './imageNode';

function fakeTexture(width: number, height: number): THREE.Texture {
  const texture = new THREE.Texture();
  texture.image = { width, height };
  return texture;
}

function context(textures: Map<string, THREE.Texture>): NodeContext {
  return { doc: { layers: [] } as never, textures, renderer: null };
}

function boundsSize(geometry: THREE.BufferGeometry): { width: number; height: number } {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  return { width: box.max.x - box.min.x, height: box.max.y - box.min.y };
}

function meshOf(node: ReturnType<typeof createImageNode>): THREE.Mesh {
  return node.content.children[0] as THREE.Mesh;
}

describe('createImageNode', () => {
  it('sizes the plane from width, keeping the texture aspect', () => {
    const textures = new Map([['plate', fakeTexture(400, 200)]]);
    const layer = ImageLayerSchema.parse({ id: 'a', type: 'image', asset: 'plate', width: 200 });
    const node = createImageNode(layer, context(textures), 0);
    expect(node.size()).toEqual({ width: 200, height: 100 });
    expect(boundsSize(meshOf(node).geometry as THREE.BufferGeometry)).toEqual({ width: 200, height: 100 });
  });

  it('sizes the plane from height, keeping the texture aspect', () => {
    const textures = new Map([['plate', fakeTexture(400, 200)]]);
    const layer = ImageLayerSchema.parse({ id: 'a', type: 'image', asset: 'plate', height: 50 });
    const node = createImageNode(layer, context(textures), 0);
    expect(node.size()).toEqual({ width: 100, height: 50 });
  });

  it('uses the natural size when neither width nor height is given', () => {
    const textures = new Map([['plate', fakeTexture(400, 200)]]);
    const layer = ImageLayerSchema.parse({ id: 'a', type: 'image', asset: 'plate' });
    const node = createImageNode(layer, context(textures), 0);
    expect(node.size()).toEqual({ width: 400, height: 200 });
  });

  it('configures the material and applies tint via resolveTarget', () => {
    const textures = new Map([['plate', fakeTexture(400, 200)]]);
    const layer = ImageLayerSchema.parse({ id: 'a', type: 'image', asset: 'plate' });
    const node = createImageNode(layer, context(textures), 0);
    const material = meshOf(node).material as THREE.MeshBasicMaterial;
    expect(material.depthTest).toBe(false);
    expect(material.transparent).toBe(true);
    expect(material.toneMapped).toBe(false);

    const target = node.resolveTarget(undefined, 'tint');
    expect(target).not.toBeNull();
    target!.setColor!('#ff0000');
    expect(`#${material.color.getHexString()}`).toBe('#ff0000');
  });

  it('applyOpacity sets material.opacity', () => {
    const textures = new Map([['plate', fakeTexture(400, 200)]]);
    const layer = ImageLayerSchema.parse({ id: 'a', type: 'image', asset: 'plate' });
    const node = createImageNode(layer, context(textures), 0);
    node.applyOpacity(0.25);
    expect((meshOf(node).material as THREE.MeshBasicMaterial).opacity).toBe(0.25);
  });

  it('rejects ready with the asset id when the texture is missing, without throwing', async () => {
    const layer = ImageLayerSchema.parse({ id: 'a', type: 'image', asset: 'plate' });
    const node = createImageNode(layer, context(new Map()), 0);
    expect(node.size()).toEqual({ width: 0, height: 0 });
    expect(node.content.children).toHaveLength(0);
    await expect(node.ready).rejects.toThrow('plate');
    expect(node.resolveTarget(undefined, 'tint')).toBeNull();
  });
});
