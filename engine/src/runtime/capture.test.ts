import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { cellLabel, evenFrames, exportPack, gridLayout, renderPass, type CaptureRuntime } from './capture';

describe('gridLayout', () => {
  it('12 frames in 4 columns make 3 rows', () => {
    const g = gridLayout(12, 4, 320, 180, 22);
    expect(g.cols).toBe(4);
    expect(g.rows).toBe(3);
    expect(g.width).toBe(1280);
    expect(g.height).toBe(3 * 202);
    expect(g.cells[0]).toEqual({ x: 0, y: 0 });
    expect(g.cells[4]).toEqual({ x: 0, y: 202 });
    expect(g.cells[11]).toEqual({ x: 960, y: 404 });
  });
  it('clamps columns to the frame count and rounds rows up', () => {
    expect(gridLayout(2, 4, 10, 10, 2).cols).toBe(2);
    expect(gridLayout(5, 4, 10, 10, 2).rows).toBe(2);
  });
});

describe('frame list and labels', () => {
  it('spreads frames evenly, ends inclusive', () => {
    const f = evenFrames(12, 0, 110);
    expect(f).toHaveLength(12);
    expect(f[0]).toBe(0);
    expect(f[11]).toBe(110);
  });
  it('de-duplicates when the range is short', () => {
    expect(evenFrames(12, 0, 3)).toEqual([0, 1, 2, 3]);
  });
  it('label shows frame number and time', () => {
    expect(cellLabel(45, 30)).toBe('f45  1.50s');
  });
});

function fakeRuntime(opts: { failRender?: boolean } = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#123456');
  const shadow = new THREE.Mesh();
  scene.add(shadow);
  const camera = new THREE.PerspectiveCamera();
  const log: string[] = [];
  const clearColor = new THREE.Color('#abcdef');
  const state = { autoClear: true, scissorTest: false, alpha: 0.5 };
  const renderer = {
    get autoClear() {
      return state.autoClear;
    },
    set autoClear(v: boolean) {
      state.autoClear = v;
    },
    getClearColor: (c: THREE.Color) => c.copy(clearColor),
    getClearAlpha: () => state.alpha,
    setClearColor: vi.fn((c: THREE.Color, a: number) => {
      clearColor.copy(c);
      state.alpha = a;
    }),
    getViewport: (v: THREE.Vector4) => v.set(0, 0, 100, 50),
    setViewport: vi.fn(),
    getScissor: (v: THREE.Vector4) => v.set(1, 2, 3, 4),
    setScissor: vi.fn(),
    getScissorTest: () => state.scissorTest,
    setScissorTest: vi.fn((v: boolean) => {
      state.scissorTest = v;
    }),
    getRenderTarget: () => null,
    setRenderTarget: vi.fn(),
    clear: vi.fn(),
    render: vi.fn(() => {
      log.push(`render override=${scene.overrideMaterial?.type} bg=${String(scene.background)} shadow=${shadow.visible}`);
      if (opts.failRender) throw new Error('boom');
    }),
  };
  const canvas = { width: 100, height: 50, toBlob: (cb: (b: Blob) => void) => cb(new Blob(['x'])) } as unknown as HTMLCanvasElement;
  const rt: CaptureRuntime = {
    renderFrame: async () => canvas,
    getCanvas: () => canvas,
    getTime: () => 1.5,
    getFps: () => 30,
    getDoc: () => null,
    getRenderer: () => renderer as unknown as THREE.WebGLRenderer,
    passTargets: () => [{ scene, camera, x: 0, y: 0, width: 100, height: 50, hide: [shadow] }],
    seek: vi.fn(() => log.push('seek')),
    redraw: vi.fn(() => log.push('redraw')),
  };
  return { rt, scene, shadow, renderer, log, clearColor, state };
}

describe('renderPass', () => {
  it.each(['depth', 'normal'] as const)('%s: uses an override, then restores everything and redraws', async (pass) => {
    const f = fakeRuntime();
    const blob = await renderPass(f.rt, 10, pass);
    expect(blob).toBeInstanceOf(Blob);
    expect(f.log[0]).toBe(`render override=${pass === 'depth' ? 'MeshDepthMaterial' : 'MeshNormalMaterial'} bg=null shadow=false`);
    expect(f.scene.overrideMaterial).toBeNull();
    expect((f.scene.background as THREE.Color).getHexString()).toBe('123456');
    expect(f.shadow.visible).toBe(true);
    expect(f.state.autoClear).toBe(true);
    expect(f.clearColor.getHexString()).toBe('abcdef');
    expect(f.state.alpha).toBe(0.5);
    expect(f.renderer.setViewport).toHaveBeenLastCalledWith(expect.objectContaining({ z: 100, w: 50 }));
    expect(f.rt.seek).toHaveBeenCalledWith(1.5);
    expect(f.log.slice(-2)).toEqual(['seek', 'redraw']);
  });

  it('restores even when a render throws', async () => {
    const f = fakeRuntime({ failRender: true });
    await expect(renderPass(f.rt, 3, 'depth')).rejects.toThrow('boom');
    expect(f.scene.overrideMaterial).toBeNull();
    expect(f.shadow.visible).toBe(true);
    expect(f.state.autoClear).toBe(true);
    expect(f.rt.redraw).toHaveBeenCalled();
  });
});

describe('exportPack', () => {
  it('91 camera entries per visible three layer with unit quaternions; summary names text and objects', async () => {
    const f = fakeRuntime();
    const cam = f.rt.passTargets()[0].camera as THREE.PerspectiveCamera;
    let t = 0;
    f.rt.seek = vi.fn((sec: number) => {
      t = sec;
      cam.position.set(0, 1, 5 - sec);
      cam.lookAt(0, 0.5, 0);
    });
    f.rt.getTime = () => t;
    f.rt.passTargets = () => [{ id: 'hero', scene: f.scene, camera: cam, x: 0, y: 0, width: 100, height: 50 }];
    f.rt.getDoc = () =>
      ({
        width: 1920,
        height: 1080,
        fps: 30,
        duration: 7,
        layers: [
          { id: 'title', type: 'text', text: 'Hello World', style: {} },
          { id: 'hero', type: 'three', objects: [{ id: 'can', geometry: { type: 'box' } }, { id: 'ring', geometry: { type: 'torus' } }] },
        ],
      }) as never;
    const ctx = { fillRect() {}, fillText() {}, drawImage() {}, set fillStyle(_v: string) {}, set font(_v: string) {}, set textBaseline(_v: string) {} };
    const proto = HTMLCanvasElement.prototype;
    const getCtx = vi.spyOn(proto, 'getContext').mockReturnValue(ctx as never);
    const toBlob = vi.spyOn(proto, 'toBlob').mockImplementation((cb: BlobCallback) => cb(new Blob(['x'])));
    const pack = await exportPack(f.rt, { from: 0, to: 90 });
    const mine = pack.camera.filter((c) => c.layerId === 'hero');
    expect(mine).toHaveLength(91);
    for (const c of mine) expect(Math.abs(Math.hypot(...c.quaternion) - 1)).toBeLessThan(1e-6);
    expect(pack.summary).toContain('Hello World');
    expect(pack.summary).toContain('can');
    expect(pack.summary).toContain('ring');
    expect(pack.summary).toContain('Camera moves');
    getCtx.mockRestore();
    toBlob.mockRestore();
    for (const b of [pack.first, pack.last, pack.firstDepth, pack.firstNormal, pack.contactSheet]) expect(b).toBeInstanceOf(Blob);
  });
});
