import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ThreeLayerSchema } from '../schema/layer3d';
import { transitionFragment, uniformValue, usable } from './transition';

describe('shader transitions', () => {
  it('wraps a gl-transitions function with the texture lookups, progress and ratio it expects', () => {
    const frag = transitionFragment('vec4 transition(vec2 uv) { return mix(getFromColor(uv), getToColor(uv), progress); }');
    expect(frag).toContain('uniform sampler2D from;');
    expect(frag).toContain('uniform float progress;');
    expect(frag).toContain('vec4 getToColor(vec2 uv)');
    expect(frag).toContain('gl_FragColor = transition(vUv);');
  });

  it('turns a param into the uniform its declared type wants, falling back to the shader\'s own default', () => {
    expect(uniformValue('float', 0.7, 0.4)).toBe(0.7);
    expect(uniformValue('float', undefined, 0.4)).toBe(0.4);
    expect(uniformValue('bool', undefined, true)).toBe(true);
    expect(uniformValue('vec3', undefined, [0.9, 0.4, 0.2])).toEqual(new THREE.Vector3(0.9, 0.4, 0.2));
    expect(uniformValue('vec2', [1, 2, 3], [-1, 0])).toEqual(new THREE.Vector2(-1, 0));
    expect(uniformValue('vec4', [0, 0, 0, 0.6], undefined)).toEqual(new THREE.Vector4(0, 0, 0, 0.6));
  });

  it('cannot run a transition that needs a second picture', () => {
    expect(usable({ name: 'a', glsl: '', defaultParams: {}, paramsTypes: { strength: 'float' } })).toBe(true);
    expect(usable({ name: 'b', glsl: '', defaultParams: {}, paramsTypes: { displacementMap: 'sampler2D' } })).toBe(false);
  });

  it('a three layer may carry transitions, with their time inside the allowed range', () => {
    const base = { id: 'w', type: 'three', width: 64, height: 64, objects: [{ id: 'o', geometry: { type: 'box', size: [1, 1, 1] } }] };
    expect(ThreeLayerSchema.safeParse({ ...base, transitions: [{ at: 1, duration: 0.4, name: 'CrossZoom', params: { strength: 0.5 } }] }).success).toBe(true);
    expect(ThreeLayerSchema.safeParse({ ...base, transitions: [{ at: 1, duration: 5, name: 'CrossZoom' }] }).success).toBe(false);
  });
});

describe('cinematic transitions', () => {
  it('are found by name beside the collection, each a transition function over named uniforms with defaults', async () => {
    const { CINEMATIC_TRANSITIONS } = await import('./cinematicTransitions');
    const { loadGlTransitions } = await import('./transition');
    const lib = await loadGlTransitions();
    for (const t of CINEMATIC_TRANSITIONS) {
      expect(lib.find(t.name)).toBe(t);
      expect(t.glsl).toContain('vec4 transition(vec2 uv)');
      expect(usable(t)).toBe(true);
      for (const name of Object.keys(t.paramsTypes)) {
        expect(t.glsl).toContain(`uniform ${t.paramsTypes[name]} ${name};`);
        expect(t.defaultParams[name]).toBeDefined();
      }
    }
    expect(CINEMATIC_TRANSITIONS.map((t) => t.name)).toEqual(['LensWhip', 'LightLeak', 'ZoomPunch']);
  });
});
