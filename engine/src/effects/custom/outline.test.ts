import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { OutlineEffect2D } from './outline';

function expectColorClose(actual: THREE.Color, expected: THREE.Color, epsilon = 1e-6): void {
  expect(Math.abs(actual.r - expected.r)).toBeLessThanOrEqual(epsilon);
  expect(Math.abs(actual.g - expected.g)).toBeLessThanOrEqual(epsilon);
  expect(Math.abs(actual.b - expected.b)).toBeLessThanOrEqual(epsilon);
}

describe('OutlineEffect2D', () => {
  it('sets uniforms from construction options', () => {
    const effect = new OutlineEffect2D({ thickness: 3, color: '#ff0000' });

    expect(effect.thickness).toBe(3);
    expectColorClose(effect.uniforms.get('color')!.value as THREE.Color, new THREE.Color('#ff0000'));
  });

  it('defaults color, thickness and alpha when no options are given', () => {
    const effect = new OutlineEffect2D();

    expectColorClose(effect.uniforms.get('color')!.value as THREE.Color, new THREE.Color('#000000'));
    expect(effect.thickness).toBe(2);
    expect(effect.alpha).toBe(1);
  });

  it('getter/setter for color updates the uniform', () => {
    const effect = new OutlineEffect2D({ color: '#ff0000' });

    effect.color = '#00ff00';

    expect(effect.color).toBe('#00ff00');
    expectColorClose(effect.uniforms.get('color')!.value as THREE.Color, new THREE.Color('#00ff00'));
  });

  it('getter/setter for thickness updates the uniform', () => {
    const effect = new OutlineEffect2D({ thickness: 3 });

    effect.thickness = 5;

    expect(effect.thickness).toBe(5);
    expect(effect.uniforms.get('thickness')!.value).toBe(5);
  });

  it('getter/setter for alpha updates the uniform', () => {
    const effect = new OutlineEffect2D({ alpha: 1 });

    effect.alpha = 0.5;

    expect(effect.alpha).toBe(0.5);
    expect(effect.uniforms.get('alpha')!.value).toBe(0.5);
  });

  it('setSize sets the texel uniform to the reciprocal of width and height', () => {
    const effect = new OutlineEffect2D();

    effect.setSize(400, 200);

    const texel = effect.uniforms.get('texel')!.value as THREE.Vector2;
    expect(texel.x).toBeCloseTo(1 / 400);
    expect(texel.y).toBeCloseTo(1 / 200);
  });
});
