import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { setEffectChainFactoryForTests, type EffectChainOptions } from './chain';
import { buildStageChain } from './stage';

const SIZE = { width: 1920, height: 1080 };

describe('buildStageChain', () => {
  afterEach(() => {
    setEffectChainFactoryForTests(null);
  });

  it('returns null with no effects', () => {
    const renderer = {} as THREE.WebGLRenderer;
    const stage = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    expect(buildStageChain(renderer, stage, camera, [], SIZE)).toBeNull();
  });

  it('returns null when every effect is disabled', () => {
    const renderer = {} as THREE.WebGLRenderer;
    const stage = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    expect(
      buildStageChain(renderer, stage, camera, [{ id: 'v', type: 'vignette', enabled: false }], SIZE),
    ).toBeNull();
  });

  it('builds a chain with output null and toneMapping false for an enabled effect', () => {
    const captured: { opts: EffectChainOptions | null } = { opts: null };
    const fakeChain = { render: () => {}, setSize: () => {}, resolveTarget: () => null, dispose: () => {}, errors: [] };
    setEffectChainFactoryForTests((opts) => {
      captured.opts = opts;
      return fakeChain;
    });

    const renderer = {} as THREE.WebGLRenderer;
    const stage = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const chain = buildStageChain(renderer, stage, camera, [{ id: 'v', type: 'vignette' }], SIZE);

    expect(chain).toBe(fakeChain);
    const opts = captured.opts;
    if (!opts) throw new Error('expected buildEffectChain to have been called');
    expect(opts.output).toBeNull();
    expect(opts.toneMapping).toBe(false);
    expect(opts.scene).toBe(stage);
    expect(opts.size).toEqual(SIZE);
  });
});
