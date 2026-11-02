import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { GlowEffect } from './glow';

function expectColorClose(actual: THREE.Color, expected: THREE.Color, epsilon = 1e-6): void {
  expect(Math.abs(actual.r - expected.r)).toBeLessThanOrEqual(epsilon);
  expect(Math.abs(actual.g - expected.g)).toBeLessThanOrEqual(epsilon);
  expect(Math.abs(actual.b - expected.b)).toBeLessThanOrEqual(epsilon);
}

describe('GlowEffect', () => {
  it('sets uniforms from construction options', () => {
    const effect = new GlowEffect({ color: '#ffd27a', strength: 2, distance: 10 });

    expect(effect.uniforms.get('strength')!.value).toBe(2);
    expect(effect.uniforms.get('distance')!.value).toBe(10);
    expectColorClose(effect.uniforms.get('color')!.value as THREE.Color, new THREE.Color('#ffd27a'));
  });

  it('defaults color, strength and distance when no options are given', () => {
    const effect = new GlowEffect();

    expectColorClose(effect.uniforms.get('color')!.value as THREE.Color, new THREE.Color('#ffffff'));
    expect(effect.uniforms.get('strength')!.value).toBe(2);
    expect(effect.uniforms.get('distance')!.value).toBe(10);
  });

  it('getter/setter for color updates the uniform', () => {
    const effect = new GlowEffect({ color: '#ffd27a' });

    effect.color = '#000000';

    expect(effect.color).toBe('#000000');
    expectColorClose(effect.uniforms.get('color')!.value as THREE.Color, new THREE.Color('#000000'));
  });

  it('getter/setter for strength updates the uniform', () => {
    const effect = new GlowEffect({ strength: 2 });

    effect.strength = 5;

    expect(effect.strength).toBe(5);
    expect(effect.uniforms.get('strength')!.value).toBe(5);
  });

  it('getter/setter for distance updates the uniform', () => {
    const effect = new GlowEffect({ distance: 10 });

    effect.distance = 20;

    expect(effect.distance).toBe(20);
    expect(effect.uniforms.get('distance')!.value).toBe(20);
  });

  it('setSize sets the texel uniform to the reciprocal of width and height', () => {
    const effect = new GlowEffect();

    effect.setSize(400, 200);

    const texel = effect.uniforms.get('texel')!.value as THREE.Vector2;
    expect(texel.x).toBeCloseTo(1 / 400);
    expect(texel.y).toBeCloseTo(1 / 200);
  });
});
