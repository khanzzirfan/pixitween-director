import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { EFFECTS, PASS_EFFECTS, effectReach, padding, type EffectDef } from './table';
import { EFFECT_SCOPES, type EffectType } from '../schema';

const camera = new THREE.PerspectiveCamera();

/** Asserts the shared contract of one table entry against its live effect. */
const ctx = { camera, size: { width: 64, height: 64 } };

function def(type: EffectType): EffectDef {
  const found = EFFECTS[type];
  if (!found) throw new Error(`no effect ${type}`);
  return found;
}

function verify(key: EffectType): void {
  const d = def(key);
  expect(d.type).toBe(key);
  expect(d.scope).toBe(EFFECT_SCOPES[key]);

  const effect = d.create({ ...d.defaults }, ctx);

  for (const [param, spec] of Object.entries(d.tweenable)) {
    // every tweenable param must be a declared default, so `create(params)` can always seed it
    expect(Object.keys(d.defaults)).toContain(param);
    if (spec.kind === 'color') continue;

    // the freshly created effect reads back at its documented default (the uniforms are float32)
    expect(Number(spec.get(effect))).toBeCloseTo(Number(d.defaults[param]), 4);

    // and the writer/reader pair round-trips, which is what the timeline tweens through
    spec.set(effect, 4);
    expect(Number(spec.get(effect))).toBeCloseTo(4, 4);
  }
}

const ANY_AND_THREE = (Object.keys(EFFECT_SCOPES) as EffectType[]).filter((type) => EFFECT_SCOPES[type] !== '2d');
const TWO_D = (Object.keys(EFFECT_SCOPES) as EffectType[]).filter((type) => EFFECT_SCOPES[type] === '2d');

describe('EFFECTS table', () => {
  it('has an entry for every effect of scope any or three', () => {
    for (const type of ANY_AND_THREE) expect(EFFECTS[type]?.type).toBe(type);
  });

  it.each(ANY_AND_THREE)('%s defaults and tweenables round-trip', (type) => verify(type));

  it('has an entry for every 2d custom effect', () => {
    for (const type of TWO_D) expect(EFFECTS[type]?.type).toBe(type);
  });

  it.each(TWO_D)('%s defaults and tweenables round-trip', (type) => verify(type));

  it('treats blur as a pass', () => {
    expect(PASS_EFFECTS.has('blur')).toBe(true);
    expect(PASS_EFFECTS.has('bloom')).toBe(false);
  });

  it('bloom.create merges the defaults and applies intensity and the luminance threshold', () => {
    const effect = def('bloom').create({ ...def('bloom').defaults, intensity: 2 }, ctx) as unknown as { intensity: number; luminanceMaterial: { threshold: number } };
    expect(effect.intensity).toBe(2);
    expect(effect.luminanceMaterial.threshold).toBeCloseTo(0.85, 6);
  });

  it('padding is the max reach over all effects, rounded up', () => {
    expect(
      padding([
        { type: 'glow', params: { distance: 10 } },
        { type: 'dropShadow', params: { distance: 6, blur: 4 } },
      ]),
    ).toBe(10);
    expect(padding([{ type: 'blur', params: {} }])).toBe(32);
    expect(padding([{ type: 'vignette', params: {} }])).toBe(0);
  });

  it('effectReach falls back to each type\'s documented default when a param is missing', () => {
    expect(effectReach({ type: 'glow' })).toBe(10);
    expect(effectReach({ type: 'dropShadow' })).toBe(10);
    expect(effectReach({ type: 'outline' })).toBe(2);
  });

  it('declares hueSaturation.hue in degrees and converts it to radians', () => {
    const d = def('hueSaturation');
    expect(d.tweenable.hue.kind).toBe('deg');
    const effect = d.create({ ...d.defaults, hue: 90 }, ctx) as unknown as { hue: number };
    expect(effect.hue).toBeCloseTo(Math.PI / 2, 6);
    expect(Number(d.tweenable.hue.get(effect as never))).toBeCloseTo(90, 4);
  });
});
