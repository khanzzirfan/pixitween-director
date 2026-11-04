import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLayerObjects } from '../core/transform';
import type { MotionNode } from '../core/types';
import { setEffectChainFactoryForTests, type EffectChainFactory } from './chain';
import { isolateNode } from './isolate';

function fakeNode(width: number, height: number): MotionNode {
  const { display, content } = createLayerObjects({ id: 'n1' });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1));
  content.add(mesh);
  return {
    id: 'n1',
    layer: {} as MotionNode['layer'],
    display,
    content,
    start: 0,
    end: 1,
    children: [],
    alpha: { value: 1 },
    warnings: [],
    size: () => ({ width, height }),
    resolveTarget: () => null,
    applyOpacity: () => {},
    ready: Promise.resolve(),
    destroy: () => {},
  };
}

const renderer = {} as THREE.WebGLRenderer;

describe('isolateNode', () => {
  afterEach(() => {
    setEffectChainFactoryForTests(null);
  });

  it('sizes the target and camera to the padding a glow needs', () => {
    let captured: Parameters<EffectChainFactory>[0] | null = null;
    const fake = { render: vi.fn(), setSize: vi.fn(), resolveTarget: () => null, dispose: vi.fn(), errors: [] };
    setEffectChainFactoryForTests((opts) => {
      captured = opts;
      return fake;
    });

    const node = fakeNode(200, 100);
    const iso = isolateNode(node, [{ id: 'g', type: 'glow', enabled: true, params: { distance: 10 } }], renderer);

    expect(captured).not.toBeNull();
    expect(captured!.size).toEqual({ width: 220, height: 120 });
    const camera = captured!.camera as THREE.OrthographicCamera;
    expect(camera.left).toBe(-10);
    expect(camera.right).toBe(210);
    expect(camera.top).toBe(10);
    expect(camera.bottom).toBe(-110);

    iso.dispose();
  });

  it('moves content out of display into the isolated scene, replacing it with the plane; dispose restores it', () => {
    const fake = { render: vi.fn(), setSize: vi.fn(), resolveTarget: () => null, dispose: vi.fn(), errors: [] };
    setEffectChainFactoryForTests(() => fake);

    const node = fakeNode(200, 100);
    const content = node.content;
    expect(node.display.children).toContain(content);

    const iso = isolateNode(node, [], renderer);
    expect(node.display.children).not.toContain(content);
    expect(node.display.children).toHaveLength(1);
    const plane = node.display.children[0];
    expect((plane as THREE.Mesh).isMesh).toBe(true);

    iso.dispose();
    expect(node.display.children).toContain(content);
    expect(node.display.children).not.toContain(plane);
  });

  it('update renders through the chain once; resolveTarget delegates to the chain', () => {
    const ref = { obj: {}, key: 'strength', kind: 'number' as const };
    const fake = {
      render: vi.fn(),
      setSize: vi.fn(),
      resolveTarget: vi.fn(() => ref),
      dispose: vi.fn(),
      errors: [],
    };
    setEffectChainFactoryForTests(() => fake);

    const node = fakeNode(200, 100);
    const iso = isolateNode(node, [{ id: 'g', type: 'glow', enabled: true, params: {} }], renderer);

    iso.update(1, 30);
    expect(fake.render).toHaveBeenCalledTimes(1);
    expect(fake.render).toHaveBeenCalledWith(renderer);

    expect(iso.resolveTarget('g', 'strength')).toBe(ref);
    expect(fake.resolveTarget).toHaveBeenCalledWith('g', 'strength');

    iso.dispose();
  });

  it('dispose disposes the render target and the plane material', () => {
    const fake = { render: vi.fn(), setSize: vi.fn(), resolveTarget: () => null, dispose: vi.fn(), errors: [] };
    setEffectChainFactoryForTests(() => fake);

    const node = fakeNode(200, 100);
    const iso = isolateNode(node, [], renderer);
    const plane = node.display.children[0] as THREE.Mesh;
    const material = plane.material as THREE.Material;
    const materialDisposeSpy = vi.spyOn(material, 'dispose');

    iso.dispose();

    expect(fake.dispose).toHaveBeenCalledTimes(1);
    expect(materialDisposeSpy).toHaveBeenCalledTimes(1);
  });
});
