import * as THREE from 'three';
import type { MotionDoc } from '../schema/doc';

export interface LoadedImageTextures {
  textures: Map<string, THREE.Texture>;
  errors: Array<{ assetId: string; error: unknown }>;
}

async function defaultLoad(url: string): Promise<THREE.Texture> {
  return new THREE.TextureLoader().loadAsync(url);
}

/** Load every image asset in `doc.assets` as a texture, in parallel; one failure never stops the rest. */
export async function loadImageTextures(
  doc: MotionDoc,
  load: (url: string) => Promise<THREE.Texture> = defaultLoad,
): Promise<LoadedImageTextures> {
  const textures = new Map<string, THREE.Texture>();
  const errors: Array<{ assetId: string; error: unknown }> = [];

  await Promise.all(
    Object.entries(doc.assets)
      .filter(([, asset]) => asset.type === 'image')
      .map(async ([assetId, asset]) => {
        try {
          const texture = await load(asset.url);
          texture.colorSpace = THREE.SRGBColorSpace;
          textures.set(assetId, texture);
        } catch (error) {
          errors.push({ assetId, error });
        }
      }),
  );

  return { textures, errors };
}

export function disposeTextures(textures: Map<string, THREE.Texture>): void {
  for (const texture of textures.values()) {
    texture.dispose();
  }
}
