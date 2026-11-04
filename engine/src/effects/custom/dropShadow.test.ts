import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { DropShadowEffect } from './dropShadow';

function expectColorClose(actual: THREE.Color, expected: THREE.Color, epsilon = 1e-6): void {
  expect(Math.abs(actual.r - expected.r)).toBeLessThanOrEqual(epsilon);
  expect(Math.abs(actual.g - expected.g)).toBeLessThanOrEqual(epsilon);
  expect(Math.abs(actual.b - expected.b)).toBeLessThanOrEqual(epsilon);
}

function expectVec2Close(actual: THREE.Vector2, x: number, y: number, epsilon = 1e-6): void {
  expect(Math.abs(actual.x - x)).toBeLessThanOrEqual(epsilon);
  expect(Math.abs(actual.y - y)).toBeLessThanOrEqual(epsilon);
}

describe('DropShadowEffect', () => {
  it('computes the offset uniform from distance and angle (y down in doc -> y up in UV)', () => {
    const effect = new DropShadowEffect({ distance: 6, angle: 45 });

    const rad = (45 * Math.PI) / 180;
    expectVec2Close(effect.uniforms.get('offset')!.value as THREE.Vector2, 6 * Math.cos(rad), -6 * Math.sin(rad));
  });

  it('updates the offset uniform when angle is set to 90', () => {
    const effect = new DropShadowEffect({ distance: 6, angle: 45 });

    effect.angle = 90;

    expect(effect.angle).toBe(90);
    expectVec2Close(effect.uniforms.get('offset')!.value as THREE.Vector2, 0, -6);
  });

  it('updates the offset uniform when distance is set', () => {
    const effect = new DropShadowEffect({ distance: 6, angle: 90 });

    effect.distance = 12;

    expect(effect.distance).toBe(12);
    expectVec2Close(effect.uniforms.get('offset')!.value as THREE.Vector2, 0, -12);
  });

  it('defaults color, alpha, distance, angle and blur when no options are given', () => {
    const effect = new DropShadowEffect();

    expectColorClose(effect.uniforms.get('color')!.value as THREE.Color, new THREE.Color('#000000'));
    expect(effect.uniforms.get('alpha')!.value).toBe(0.5);
    expect(effect.distance).toBe(6);
    expect(effect.angle).toBe(45);
    expect(effect.uniforms.get('blur')!.value).toBe(4);
  });

  it('getter/setter for color updates the uniform', () => {
    const effect = new DropShadowEffect();

    effect.color = '#ff0000';

    expect(effect.color).toBe('#ff0000');
    expectColorClose(effect.uniforms.get('color')!.value as THREE.Color, new THREE.Color('#ff0000'));
  });

  it('getter/setter for alpha updates the uniform', () => {
    const effect = new DropShadowEffect({ alpha: 0.5 });

    effect.alpha = 0.8;

    expect(effect.alpha).toBe(0.8);
    expect(effect.uniforms.get('alpha')!.value).toBe(0.8);
  });

  it('getter/setter for blur updates the uniform', () => {
    const effect = new DropShadowEffect({ blur: 4 });

    effect.blur = 10;

    expect(effect.blur).toBe(10);
    expect(effect.uniforms.get('blur')!.value).toBe(10);
  });

  it('setSize sets the texel uniform to the reciprocal of width and height', () => {
    const effect = new DropShadowEffect();

    effect.setSize(400, 200);

    const texel = effect.uniforms.get('texel')!.value as THREE.Vector2;
    expect(texel.x).toBeCloseTo(1 / 400);
    expect(texel.y).toBeCloseTo(1 / 200);
  });
});
