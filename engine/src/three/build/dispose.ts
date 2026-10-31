// Ported from reacthub-pixitweenjs src/components/AepComposition/model3d/threeUtils.ts (MIT).
import type * as THREE from 'three';

/** Textures flagged `userData.shared` (e.g. the cached toon gradient or room env map) outlive any one object. */
export function isSharedTexture(texture: THREE.Texture): boolean {
  return texture.userData?.shared === true;
}

export interface DisposeOptions {
  /**
   * Dispose only resources flagged `userData.stageOwned`. A stage3d member shares geometries,
   * materials and textures with its cached glTF (clones reference them), so it frees only what it
   * created itself.
   */
  onlyOwned?: boolean;
}

const isOwned = (resource: { userData?: Record<string, unknown> }): boolean => resource.userData?.stageOwned === true;

export function disposeObject3D(root: THREE.Object3D, options: DisposeOptions = {}): void {
  const onlyOwned = options.onlyOwned === true;
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (!onlyOwned || (mesh.geometry && isOwned(mesh.geometry))) {
      mesh.geometry?.dispose();
    }
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (!material) continue;
      for (const value of Object.values(material)) {
        const texture = value as THREE.Texture;
        if (texture && texture.isTexture && !isSharedTexture(texture) && (!onlyOwned || isOwned(texture))) {
          texture.dispose();
        }
      }
      if (!onlyOwned || isOwned(material)) material.dispose();
    }
  });
}
