import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { type Material } from '../../schema/layer3d';
import { makeMaterial } from './materials';

const base: Material = {
  color: '#cccccc',
  roughness: 0.4,
  metalness: 0,
  emissive: '#000000',
  emissiveIntensity: 0,
  opacity: 1,
};

describe('makeMaterial', () => {
  it('returns a MeshStandardMaterial', () => {
    expect(makeMaterial(base).isMeshStandardMaterial).toBe(true);
  });

  it('opacity 0.5 sets transparent true and copies opacity', () => {
    const material = makeMaterial({ ...base, opacity: 0.5 });
    expect(material.transparent).toBe(true);
    expect(material.opacity).toBe(0.5);
  });

  it('opacity 1 leaves transparent false', () => {
    const material = makeMaterial(base);
    expect(material.transparent).toBe(false);
    expect(material.opacity).toBe(1);
  });

  it('copies roughness, metalness, emissive and emissiveIntensity', () => {
    const material = makeMaterial({ ...base, roughness: 0.25, metalness: 0.8, emissive: '#ff0000', emissiveIntensity: 0.6 });
    expect(material.roughness).toBe(0.25);
    expect(material.metalness).toBe(0.8);
    expect(material.emissive.getHexString()).toBe('ff0000');
    expect(material.emissiveIntensity).toBe(0.6);
  });

  it('copies the colour when there is no map', () => {
    expect(makeMaterial({ ...base, color: '#4fc3f7' }).color.getHexString()).toBe('4fc3f7');
  });

  it('resolves a map from the textures and keeps the tint white', () => {
    const texture = new THREE.Texture();
    const material = makeMaterial({ ...base, color: '#4fc3f7', map: 'label' }, new Map([['label', texture]]));
    expect(material.map).toBe(texture);
    expect(material.color.getHexString()).toBe('ffffff');
    expect(texture.colorSpace).toBe(THREE.SRGBColorSpace);
  });

  it('ignores a map id with no texture', () => {
    expect(makeMaterial({ ...base, map: 'missing' }, new Map()).map).toBeNull();
  });
});
