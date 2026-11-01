// Ported from reacthub-pixitweenjs src/components/AepComposition/model3d/threeUtils.ts (MIT).
import * as THREE from 'three';
import { type Material } from '../../schema/layer3d';

// Standard (not physical) material: the spec has no clearcoat, so a cheaper material keeps scenes
// building quickly.
export function makeMaterial(spec: Material, textures: ReadonlyMap<string, THREE.Texture> = new Map()): THREE.MeshStandardMaterial {
  const map = spec.map ? (textures.get(spec.map) ?? null) : null;
  if (map && map.wrapS !== THREE.RepeatWrapping) {
    map.wrapS = THREE.RepeatWrapping;
    map.wrapT = THREE.ClampToEdgeWrapping;
    map.colorSpace = THREE.SRGBColorSpace;
    map.needsUpdate = true;
  }
  const material = new THREE.MeshStandardMaterial({
    // A tinted material multiplies the texture; keep it white when a map is present so the label
    // keeps its authored colours.
    color: new THREE.Color(map ? '#ffffff' : spec.color),
    map,
    roughness: spec.roughness,
    metalness: spec.metalness,
    emissive: new THREE.Color(spec.emissive),
    emissiveIntensity: spec.emissiveIntensity,
    transparent: spec.opacity < 1,
    opacity: spec.opacity,
  });
  material.shadowSide = THREE.FrontSide;
  return material;
}

export async function loadTexture(url: string): Promise<THREE.Texture> {
  const texture = await new THREE.TextureLoader().loadAsync(url);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}
