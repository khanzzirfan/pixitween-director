// Ported from reacthub-pixitweenjs src/components/AepComposition/model3d/threeUtils.ts (MIT).
import * as THREE from 'three';
import { type Material } from '../../schema/layer3d';

// Standard material, or physical when the spec asks for clearcoat or transmission (the cheaper
// standard material keeps plain scenes building quickly).
export function makeMaterial(spec: Material, textures: ReadonlyMap<string, THREE.Texture> = new Map()): THREE.MeshStandardMaterial {
  const map = spec.map ? (textures.get(spec.map) ?? null) : null;
  if (map && map.wrapS !== THREE.RepeatWrapping) {
    map.wrapS = THREE.RepeatWrapping;
    map.wrapT = THREE.ClampToEdgeWrapping;
    map.colorSpace = THREE.SRGBColorSpace;
    map.needsUpdate = true;
  }
  const options: THREE.MeshPhysicalMaterialParameters = {
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
  };
  const physical = spec.clearcoat !== undefined || (spec.transmission ?? 0) > 0;
  const material = physical ? new THREE.MeshPhysicalMaterial(options) : new THREE.MeshStandardMaterial(options);
  if (material instanceof THREE.MeshPhysicalMaterial) {
    material.clearcoat = spec.clearcoat ?? 0;
    material.clearcoatRoughness = 0.2;
    if ((spec.transmission ?? 0) > 0) {
      // Glass: transmission refracts what is behind it, so it is not alpha-blended.
      material.transmission = spec.transmission ?? 0;
      material.ior = spec.ior ?? 1.5;
      material.thickness = spec.thickness ?? 0.02;
      material.transparent = false;
    }
  }
  if (spec.opacity < 1) material.depthWrite = false;
  material.shadowSide = THREE.FrontSide;
  return material;
}

/**
 * A flat image card: no lighting, cut out by the map's alpha, both sides drawn, drawn after the opaque
 * objects without writing depth (so overlapping cards blend instead of hiding each other).
 */
export function makeUnlitMaterial(spec: Material, textures: ReadonlyMap<string, THREE.Texture> = new Map()): THREE.MeshBasicMaterial {
  const map = spec.map ? (textures.get(spec.map) ?? null) : null;
  if (map) {
    map.wrapS = THREE.ClampToEdgeWrapping;
    map.wrapT = THREE.ClampToEdgeWrapping;
    map.colorSpace = THREE.SRGBColorSpace;
    map.needsUpdate = true;
  }
  return new THREE.MeshBasicMaterial({
    color: new THREE.Color(map ? '#ffffff' : spec.color),
    map,
    transparent: true,
    opacity: spec.opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
    alphaTest: 0.01,
  });
}

export async function loadTexture(url: string): Promise<THREE.Texture> {
  const texture = await new THREE.TextureLoader().loadAsync(url);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}
