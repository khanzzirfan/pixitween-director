import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_LIGHTING_PRESET,
  LIGHT_DISTANCE,
  LIGHTING_PRESETS,
  applyLightingRig,
  createLightingRig,
  directionFromAzimuthElevation,
  disposeLightingRig,
  resolveLightingConfig,
} from './lighting';

describe('LIGHTING_PRESETS', () => {
  it('studio matches the library numbers', () => {
    expect(LIGHTING_PRESETS.studio.keyAzimuth).toBe(-35);
    expect(LIGHTING_PRESETS.studio.keyElevation).toBe(38);
    expect(LIGHTING_PRESETS.studio.keyIntensity).toBe(3.2);
  });

  it('defaults to studio', () => {
    expect(DEFAULT_LIGHTING_PRESET).toBe('studio');
  });
});

describe('resolveLightingConfig', () => {
  it('returns the studio table by default', () => {
    expect(resolveLightingConfig()).toEqual(LIGHTING_PRESETS.studio);
  });

  it('applies overrides and keeps the rest of the table', () => {
    const config = resolveLightingConfig('studio', { keyIntensity: 5, keyColor: '#000000' });
    expect(config.keyIntensity).toBe(5);
    expect(config.keyColor).toBe('#000000');
    expect(config.fillIntensity).toBe(LIGHTING_PRESETS.studio.fillIntensity);
  });

  it('lets an explicit environment win over the preset', () => {
    expect(resolveLightingConfig('studio', {}, 'none').environment).toBe('none');
  });

  it('builds a zeroed none config with no environment', () => {
    const config = resolveLightingConfig('none');
    expect(config.environment).toBe('none');
    expect(config.keyIntensity).toBe(0);
    expect(config.ambientIntensity).toBe(0);
  });
});

describe('directionFromAzimuthElevation', () => {
  it('(0, 90) points straight up', () => {
    const [x, y, z] = directionFromAzimuthElevation(0, 90);
    expect(y).toBeCloseTo(1, 6);
    expect(x).toBeCloseTo(0, 6);
    expect(z).toBeCloseTo(0, 6);
  });

  it('(0, 0) points along +z and (90, 0) along +x', () => {
    expect(directionFromAzimuthElevation(0, 0)).toEqual([0, 0, 1]);
    const [x] = directionFromAzimuthElevation(90, 0);
    expect(x).toBeCloseTo(1, 6);
  });
});

describe('createLightingRig', () => {
  it('studio returns key, fill, rim and ambient, and the key casts shadow', () => {
    const rig = createLightingRig(resolveLightingConfig('studio'));
    expect(rig.key).toBeInstanceOf(THREE.DirectionalLight);
    expect(rig.fill).toBeInstanceOf(THREE.DirectionalLight);
    expect(rig.rim).toBeInstanceOf(THREE.DirectionalLight);
    expect(rig.ambient).toBeInstanceOf(THREE.AmbientLight);
    expect(rig.key.castShadow).toBe(true);
    expect(rig.key.shadow.mapSize.x).toBe(1024);
    expect(rig.key.shadow.mapSize.y).toBe(1024);
    // the four lights plus the key's target
    expect(rig.group.children).toHaveLength(5);
  });

  it('places the key light along the preset direction', () => {
    const rig = createLightingRig(resolveLightingConfig('studio'));
    const [x, y, z] = directionFromAzimuthElevation(-35, 38);
    expect(rig.key.position.x).toBeCloseTo(x * LIGHT_DISTANCE, 6);
    expect(rig.key.position.y).toBeCloseTo(y * LIGHT_DISTANCE, 6);
    expect(rig.key.position.z).toBeCloseTo(z * LIGHT_DISTANCE, 6);
  });

  it('the none preset builds an empty rig', () => {
    const rig = createLightingRig(resolveLightingConfig('none'));
    expect(rig.group.children).toHaveLength(0);
  });
});

describe('applyLightingRig', () => {
  it('rewrites intensities and light directions', () => {
    const rig = createLightingRig(resolveLightingConfig('studio'));
    applyLightingRig(rig, resolveLightingConfig('golden'));
    expect(rig.key.intensity).toBe(LIGHTING_PRESETS.golden.keyIntensity);
    expect(rig.key.color.getHexString()).toBe('ffd29a');
    const [x, y, z] = directionFromAzimuthElevation(
      LIGHTING_PRESETS.golden.keyAzimuth,
      LIGHTING_PRESETS.golden.keyElevation,
    );
    expect(rig.key.position.x).toBeCloseTo(x * LIGHT_DISTANCE, 6);
    expect(rig.key.position.y).toBeCloseTo(y * LIGHT_DISTANCE, 6);
    expect(rig.key.position.z).toBeCloseTo(z * LIGHT_DISTANCE, 6);
  });
});

describe('disposeLightingRig', () => {
  it('removes the group and disposes every light', () => {
    const rig = createLightingRig(resolveLightingConfig('studio'));
    const scene = new THREE.Scene();
    scene.add(rig.group);
    const spies = [rig.key, rig.fill, rig.rim, rig.ambient].map((light) => vi.spyOn(light, 'dispose'));

    disposeLightingRig(rig);

    expect(rig.group.parent).toBeNull();
    for (const spy of spies) expect(spy).toHaveBeenCalledOnce();
  });
});