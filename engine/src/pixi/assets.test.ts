import { describe, expect, it, vi } from 'vitest';
import type { Texture } from 'pixi.js';
import { loadImageAssets, unloadImageAssets } from './assets';
import { parseMotionDoc } from '../schema';
import type { MotionDoc } from '../schema';

const texture = {} as Texture;

function makeDoc(): MotionDoc {
  const result = parseMotionDoc({
    version: 1,
    width: 1920,
    height: 1080,
    duration: 6,
    assets: {
      a: { type: 'image', url: '/a.png' },
      b: { type: 'image', url: '/b.png' },
      c: { type: 'gltf', url: '/c.glb' },
    },
    layers: [{ id: 'bg', type: 'image', asset: 'a' }],
  });
  if (!result.ok) throw new Error(`expected a valid doc: ${JSON.stringify(result.errors)}`);
  return result.doc;
}

describe('loadImageAssets', () => {
  it('loads images in parallel and reports per-asset errors', async () => {
    const load = vi.fn(async (url: string) => {
      if (url === '/b.png') throw new Error('boom');
      return texture;
    });

    const { textures, errors } = await loadImageAssets(makeDoc(), load);

    expect([...textures.keys()]).toEqual(['a']);
    expect(textures.get('a')).toBe(texture);
    expect(errors).toEqual([{ assetId: 'b', error: expect.any(Error) }]);
    expect(load).toHaveBeenCalledTimes(2);
    expect(load).toHaveBeenCalledWith('/a.png');
    expect(load).toHaveBeenCalledWith('/b.png');
  });

  it('requests every image before any of them resolves', async () => {
    const urls: string[] = [];
    const pending = new Map<string, (value: Texture) => void>();
    const load = vi.fn((url: string) => {
      urls.push(url);
      return new Promise<Texture>((resolve) => pending.set(url, resolve));
    });

    const result = loadImageAssets(makeDoc(), load);

    expect(urls).toEqual(['/a.png', '/b.png']);

    pending.get('/a.png')!(texture);
    pending.get('/b.png')!(texture);
    await expect(result).resolves.toMatchObject({ errors: [] });
  });
});

describe('unloadImageAssets', () => {
  it('unloads every image url and skips gltf', async () => {
    const unload = vi.fn(async () => {});

    await unloadImageAssets(makeDoc(), unload);

    expect(unload).toHaveBeenCalledTimes(2);
    expect(unload).toHaveBeenCalledWith('/a.png');
    expect(unload).toHaveBeenCalledWith('/b.png');
  });
});
