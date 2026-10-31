import type { Effect } from 'postprocessing';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { POSTFX_DEFS, type PostFxDef } from './effects';

const camera = new THREE.PerspectiveCamera();

/** Asserts the shared contract of one table entry against its live effect. */
function verify<E extends Effect>(key: keyof typeof POSTFX_DEFS, def: PostFxDef<E>): void {
  expect(def.type).toBe(key);

  const effect = def.create({}, camera);

  for (const [param, spec] of Object.entries(def.tweenable)) {
    // every tweenable param must be a declared default, so `create(params)` can always seed it
    expect(Object.keys(def.defaults)).toContain(param);

    // the freshly created effect reads back at its documented default (the uniforms are float32)
    expect(spec.get(effect)).toBeCloseTo(def.defaults[param], 5);

    // and the writer/reader pair round-trips, which is what the timeline tweens through
    spec.set(effect, 3);
    expect(spec.get(effect)).toBeCloseTo(3, 5);
  }
}

describe('POSTFX_DEFS table', () => {
  it('exposes the 7 post-processing effects keyed by their type', () => {
    expect(Object.keys(POSTFX_DEFS)).toEqual([
      'bloom',
      'vignette',
      'chromaticAberration',
      'noise',
      'dof',
      'brightnessContrast',
      'hueSaturation',
    ]);

    for (const [key, def] of Object.entries(POSTFX_DEFS)) {
      expect(def.type).toBe(key);
    }
  });

  it('bloom', () => verify('bloom', POSTFX_DEFS.bloom));
  it('vignette', () => verify('vignette', POSTFX_DEFS.vignette));
  it('chromaticAberration', () => verify('chromaticAberration', POSTFX_DEFS.chromaticAberration));
  it('noise', () => verify('noise', POSTFX_DEFS.noise));
  it('dof', () => verify('dof', POSTFX_DEFS.dof));
  it('brightnessContrast', () => verify('brightnessContrast', POSTFX_DEFS.brightnessContrast));
  it('hueSaturation', () => verify('hueSaturation', POSTFX_DEFS.hueSaturation));

  it('bloom.create merges the defaults and applies intensity and the luminance threshold', () => {
    const effect = POSTFX_DEFS.bloom.create({ intensity: 2 }, camera);

    expect(effect.intensity).toBe(2);
    expect(effect.luminanceMaterial.threshold).toBeCloseTo(0.85, 6);
  });

  it('declares hueSaturation.hue in degrees and converts it to radians', () => {
    expect(POSTFX_DEFS.hueSaturation.tweenable.hue.kind).toBe('deg');

    const effect = POSTFX_DEFS.hueSaturation.create({ hue: 90 }, camera);
    expect(effect.hue).toBeCloseTo(Math.PI / 2, 6);
    expect(POSTFX_DEFS.hueSaturation.tweenable.hue.get(effect)).toBeCloseTo(90, 4);
  });
});
