import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ThreeOffscreenRenderer,
  acquireOffscreenRenderer,
  createRendererPool,
  debugRendererCount,
  releaseOffscreenRenderer,
  setOffscreenRendererFactoryForTests,
  type OffscreenGlRenderer,
} from './offscreen';

// jsdom has no WebGL and no 2D canvas context, so the renderer tests inject a fake WebGL surface
// and stub `getContext('2d')` on the target canvas to a recording double.

interface ContextRecord {
  clearRect: unknown[][];
  drawImage: unknown[][];
}

function makeRecord(): ContextRecord {
  return { clearRect: [], drawImage: [] };
}

function stubCanvas2d(canvas: HTMLCanvasElement, record: ContextRecord): void {
  const ctx = {
    clearRect: (...args: unknown[]) => {
      record.clearRect.push(args);
    },
    drawImage: (...args: unknown[]) => {
      record.drawImage.push(args);
    },
  };
  (canvas as unknown as { getContext: () => unknown }).getContext = () => ctx;
}

class FakeGlRenderer implements OffscreenGlRenderer {
  readonly domElement = document.createElement('canvas');
  readonly setSizeCalls: Array<[number, number, boolean | undefined]> = [];
  readonly viewportCalls: Array<[number, number, number, number]> = [];
  readonly renderCalls: Array<[THREE.Scene, THREE.Camera]> = [];
  disposed = false;
  contextLost = false;
  private readonly size = new THREE.Vector2(0, 0);

  getSize(target: THREE.Vector2): THREE.Vector2 {
    return target.copy(this.size);
  }

  setSize(width: number, height: number, updateStyle?: boolean): void {
    this.setSizeCalls.push([width, height, updateStyle]);
    this.size.set(width, height);
    this.domElement.width = width;
    this.domElement.height = height;
  }

  setViewport(x: number, y: number, width: number, height: number): void {
    this.viewportCalls.push([x, y, width, height]);
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    this.renderCalls.push([scene, camera]);
  }

  dispose(): void {
    this.disposed = true;
  }

  forceContextLoss(): void {
    this.contextLost = true;
  }
}

describe('ThreeOffscreenRenderer.render', () => {
  it('setSize once at 512, again at 256, and again after an external drawing-buffer change', () => {
    const gl = new FakeGlRenderer();
    const renderer = new ThreeOffscreenRenderer(gl);
    const canvas = document.createElement('canvas');
    stubCanvas2d(canvas, makeRecord());
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();

    renderer.render({ canvas, scene, camera, width: 512, height: 512 });
    renderer.render({ canvas, scene, camera, width: 512, height: 512 });
    expect(gl.setSizeCalls).toEqual([[512, 512, false]]);

    renderer.render({ canvas, scene, camera, width: 256, height: 256 });
    expect(gl.setSizeCalls).toHaveLength(2);
    expect(gl.setSizeCalls[1]).toEqual([256, 256, false]);

    // e.g. an EffectComposer resized the shared drawing buffer behind our back
    gl.domElement.width = 999;
    renderer.render({ canvas, scene, camera, width: 256, height: 256 });
    expect(gl.setSizeCalls).toHaveLength(3);
  });

  it('calls draw instead of render, then drawImage on the target canvas', () => {
    const gl = new FakeGlRenderer();
    const renderer = new ThreeOffscreenRenderer(gl);
    const canvas = document.createElement('canvas');
    const record = makeRecord();
    stubCanvas2d(canvas, record);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const draw = vi.fn();

    renderer.render({ canvas, scene, camera, width: 64, height: 32, draw });

    expect(draw).toHaveBeenCalledTimes(1);
    expect(draw).toHaveBeenCalledWith(gl);
    expect(gl.renderCalls).toHaveLength(0);
    expect(record.clearRect).toEqual([[0, 0, 64, 32]]);
    expect(record.drawImage).toEqual([[gl.domElement, 0, 0, 64, 32]]);
  });

  it('renders(scene, camera) and copies to the canvas when no draw is given', () => {
    const gl = new FakeGlRenderer();
    const renderer = new ThreeOffscreenRenderer(gl);
    const canvas = document.createElement('canvas');
    const record = makeRecord();
    stubCanvas2d(canvas, record);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();

    renderer.render({ canvas, scene, camera, width: 10, height: 20 });

    expect(gl.renderCalls).toEqual([[scene, camera]]);
    expect(gl.viewportCalls).toEqual([[0, 0, 10, 20]]);
    expect(record.drawImage).toEqual([[gl.domElement, 0, 0, 10, 20]]);
  });
});

describe('createRendererPool', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shares one value per owner and disposes it once after the grace period', () => {
    vi.useFakeTimers();
    const dispose = vi.fn();
    const pool = createRendererPool(() => ({ dispose }));
    const owner = {};

    const first = pool.acquire(owner);
    expect(pool.acquire(owner)).toBe(first);

    pool.release(owner);
    pool.release(owner);
    vi.advanceTimersByTime(1999);
    expect(pool.size()).toBe(1);
    expect(dispose).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(pool.size()).toBe(0);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('cancels a pending disposal when acquired again during the grace period', () => {
    vi.useFakeTimers();
    const dispose = vi.fn();
    const pool = createRendererPool(() => ({ dispose }));
    const owner = {};

    const first = pool.acquire(owner);
    pool.release(owner);
    vi.advanceTimersByTime(1000);
    expect(pool.acquire(owner)).toBe(first);

    vi.advanceTimersByTime(2000);
    expect(pool.size()).toBe(1);
    expect(dispose).not.toHaveBeenCalled();
  });
});

describe('debugRendererCount', () => {
  afterEach(() => {
    setOffscreenRendererFactoryForTests(null);
    vi.useRealTimers();
  });

  it('counts live pooled renderers', () => {
    vi.useFakeTimers();
    setOffscreenRendererFactoryForTests(() => new ThreeOffscreenRenderer(new FakeGlRenderer()));
    const owner = {};

    expect(debugRendererCount()).toBe(0);
    acquireOffscreenRenderer(owner);
    expect(debugRendererCount()).toBe(1);

    releaseOffscreenRenderer(owner);
    vi.advanceTimersByTime(2000);
    expect(debugRendererCount()).toBe(0);
  });
});
