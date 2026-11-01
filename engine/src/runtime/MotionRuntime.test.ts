import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MotionDocInput } from '../schema';
import type { Assembly } from './assemble';
import { MotionRuntime } from './MotionRuntime';

interface FakeRenderer {
  domElement: HTMLCanvasElement;
  setPixelRatio: ReturnType<typeof vi.fn>;
  setSize: ReturnType<typeof vi.fn>;
  outputColorSpace?: THREE.ColorSpace;
  toneMapping?: THREE.ToneMapping;
  shadowMap: { enabled: boolean; type?: THREE.ShadowMapType };
  render: ReturnType<typeof vi.fn>;
  setRenderTarget: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  forceContextLoss: ReturnType<typeof vi.fn>;
  getContext: ReturnType<typeof vi.fn>;
}

function createFakeRenderer(): FakeRenderer {
  return {
    domElement: document.createElement('canvas'),
    setPixelRatio: vi.fn(),
    setSize: vi.fn(),
    shadowMap: { enabled: false },
    render: vi.fn(),
    setRenderTarget: vi.fn(),
    dispose: vi.fn(),
    forceContextLoss: vi.fn(),
    getContext: vi.fn(() => ({ readPixels: vi.fn() })),
  };
}

const validDoc: MotionDocInput = {
  version: 1,
  width: 100,
  height: 100,
  duration: 2,
  layers: [{ id: 'a', type: 'shape', shape: 'rect', width: 10, height: 10, start: 0, end: 2 }],
};

function setup() {
  let fakeRenderer!: FakeRenderer;
  let capturedParams!: THREE.WebGLRendererParameters;
  const rendererFactory = vi.fn((params: THREE.WebGLRendererParameters) => {
    capturedParams = params;
    fakeRenderer = createFakeRenderer();
    return fakeRenderer as unknown as THREE.WebGLRenderer;
  });
  const mount = document.createElement('div');
  const runtime = MotionRuntime.create({ mount, rendererFactory });
  return { runtime, mount, rendererFactory, getFakeRenderer: () => fakeRenderer, getCapturedParams: () => capturedParams };
}

describe('MotionRuntime', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates its renderer with preserveDrawingBuffer, pixel ratio 1, SRGB colour space and no tone mapping', () => {
    const { getFakeRenderer, getCapturedParams } = setup();

    expect(getCapturedParams()).toMatchObject({ preserveDrawingBuffer: true });
    expect(getFakeRenderer().setPixelRatio).toHaveBeenCalledWith(1);
    expect(getFakeRenderer().outputColorSpace).toBe(THREE.SRGBColorSpace);
    expect(getFakeRenderer().toneMapping).toBe(THREE.NoToneMapping);
  });

  it('load of an invalid doc returns ok false with errors and keeps the previous clock', async () => {
    const { runtime } = setup();

    const first = await runtime.load(validDoc);
    expect(first.ok).toBe(true);
    const durationBefore = runtime.getDuration();

    const second = await runtime.load({ version: 1, width: 100 });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.errors.length).toBeGreaterThan(0);

    expect(runtime.getDuration()).toBe(durationBefore);
  });

  it('destroy() disposes the assembly and calls renderer.dispose() and forceContextLoss()', async () => {
    const { runtime, getFakeRenderer } = setup();
    await runtime.load(validDoc);

    runtime.destroy();

    expect(getFakeRenderer().dispose).toHaveBeenCalledTimes(1);
    expect(getFakeRenderer().forceContextLoss).toHaveBeenCalledTimes(1);
  });

  describe('whenReady', () => {
    function withAssembly(runtime: MotionRuntime, ready: Promise<void>[]): void {
      const fakeAssembly = { nodes: ready.map((promise) => ({ ready: promise })) } as unknown as Assembly;
      (runtime as unknown as { assembly: Assembly }).assembly = fakeAssembly;
    }

    beforeEach(() => {
      vi.useFakeTimers();
    });

    it('resolves false when a node ready never settles', async () => {
      const { runtime } = setup();
      withAssembly(runtime, [new Promise<void>(() => {})]);

      const result = runtime.whenReady(0.05);
      await vi.advanceTimersByTimeAsync(60);

      await expect(result).resolves.toBe(false);
    });

    it('resolves true when every node ready settles', async () => {
      const { runtime } = setup();
      withAssembly(runtime, [Promise.resolve(), Promise.resolve()]);

      const result = runtime.whenReady(0.05);

      await expect(result).resolves.toBe(true);
    });

    it('resolves false when a node ready rejects', async () => {
      const { runtime } = setup();
      withAssembly(runtime, [Promise.reject(new Error('boom'))]);

      const result = runtime.whenReady(0.05);

      await expect(result).resolves.toBe(false);
    });
  });
});
