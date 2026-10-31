import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { disposeObject3D, isSharedTexture } from './dispose';

function spiedMesh() {
  const geometry = new THREE.BoxGeometry();
  const material = new THREE.MeshStandardMaterial();
  const geometryDispose = vi.fn();
  const materialDispose = vi.fn();
  geometry.dispose = geometryDispose;
  material.dispose = materialDispose;
  return { mesh: new THREE.Mesh(geometry, material), geometryDispose, materialDispose };
}

describe('disposeObject3D', () => {
  it('disposes both geometries and both materials of a group with two meshes', () => {
    const a = spiedMesh();
    const b = spiedMesh();
    const group = new THREE.Group();
    group.add(a.mesh, b.mesh);

    disposeObject3D(group);

    expect(a.geometryDispose).toHaveBeenCalledTimes(1);
    expect(a.materialDispose).toHaveBeenCalledTimes(1);
    expect(b.geometryDispose).toHaveBeenCalledTimes(1);
    expect(b.materialDispose).toHaveBeenCalledTimes(1);
  });

  it('disposes a non-shared texture but leaves a shared one alone', () => {
    const texture = new THREE.Texture();
    const textureDispose = vi.fn();
    texture.dispose = textureDispose;

    const shared = new THREE.Texture();
    shared.userData.shared = true;
    const sharedDispose = vi.fn();
    shared.dispose = sharedDispose;

    const material = new THREE.MeshStandardMaterial({ map: texture, normalMap: shared });
    disposeObject3D(new THREE.Mesh(new THREE.BoxGeometry(), material));

    expect(textureDispose).toHaveBeenCalledTimes(1);
    expect(sharedDispose).not.toHaveBeenCalled();
  });

  it('isSharedTexture reads userData.shared', () => {
    const shared = new THREE.Texture();
    shared.userData.shared = true;
    expect(isSharedTexture(shared)).toBe(true);
    expect(isSharedTexture(new THREE.Texture())).toBe(false);
  });

  it('onlyOwned disposes only resources flagged stageOwned', () => {
    const owned = new THREE.BoxGeometry();
    owned.userData.stageOwned = true;
    const ownedDispose = vi.fn();
    owned.dispose = ownedDispose;

    const borrowed = new THREE.BoxGeometry();
    const borrowedDispose = vi.fn();
    borrowed.dispose = borrowedDispose;

    disposeObject3D(new THREE.Mesh(owned), { onlyOwned: true });
    disposeObject3D(new THREE.Mesh(borrowed), { onlyOwned: true });

    expect(ownedDispose).toHaveBeenCalledTimes(1);
    expect(borrowedDispose).not.toHaveBeenCalled();
  });
});
