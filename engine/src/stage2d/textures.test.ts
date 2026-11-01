import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { MotionDoc } from '../schema/doc';
import { disposeTextures, loadImageTextures } from './textures';

const doc = {
  assets: {
    a: { type: 'image', url: '/a.png' },
    b: { type: 'image', url: '/b.png' },
    c: { type: 'gltf', url: '/c.glb' },
  },
} as unknown as MotionDoc;

describe('loadImageTextures', () => {
  it('loads every image asset in parallel and reports a failing asset without stopping the rest', () => {
    let calls = 0;
    const resolvers: Array<() => void> = [];
    const load = vi.fn((url: string) => {
      calls += 1;
      return new Promise<THREE.Texture>((resolve, reject) => {
        resolvers.push(() => {
          if (url === '/b.png') reject(new Error('b failed'));
          else resolve(new THREE.Texture());
        });
      });
    });

    const pending = loadImageTextures(doc, load);

    // Both image assets are requested before either promise settles; the gltf asset is never loaded.
    expect(calls).toBe(2);

    resolvers.forEach((resolve) => resolve());

    return pending.then((result) => {
      expect([...result.textures.keys()]).toEqual(['a']);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].assetId).toBe('b');
      expect(result.errors[0].error).toBeInstanceOf(Error);
    });
  });

  it('sets colorSpace to SRGBColorSpace on every returned texture', async () => {
    const load = vi.fn(async () => new THREE.Texture());
    const result = await loadImageTextures(doc, load);
    for (const texture of result.textures.values()) {
      expect(texture.colorSpace).toBe(THREE.SRGBColorSpace);
    }
  });
});

describe('disposeTextures', () => {
  it('disposes every texture in the map', () => {
    const textures = new Map<string, THREE.Texture>();
    const texture = new THREE.Texture();
    const dispose = vi.spyOn(texture, 'dispose');
    textures.set('a', texture);

    disposeTextures(textures);

    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
