// Ported from reacthub-pixitweenjs src/components/AepComposition/model3d/ThreeOffscreenRenderer.ts (MIT).
import * as THREE from 'three';

// One WebGLRenderer shared by every `three` layer in a Pixi Application. Each layer keeps its own
// scene + camera + 2D canvas; the service renders the scene and copies the pixels into that layer's
// canvas, which is then used as a Pixi texture. Browsers cap live WebGL contexts (~16), so this is
// what lets a page hold many 3D layers.

export interface OffscreenRenderRequest {
  canvas: HTMLCanvasElement;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  width: number;
  height: number;
  /** Replaces the plain `render(scene, camera)` (e.g. a post-processing pass). */
  draw?: (renderer: THREE.WebGLRenderer) => void;
}

/** The slice of THREE.WebGLRenderer this service uses (lets tests inject a fake). */
export interface OffscreenGlRenderer {
  readonly domElement: HTMLCanvasElement;
  getSize(target: THREE.Vector2): THREE.Vector2;
  setSize(width: number, height: number, updateStyle?: boolean): void;
  setViewport(x: number, y: number, width: number, height: number): void;
  render(scene: THREE.Scene, camera: THREE.Camera): void;
  dispose(): void;
  forceContextLoss(): void;
}

function createWebGLRenderer(): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true,
    // Required so the canvas still holds pixels when we copy it out with
    // drawImage immediately after rendering.
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.setClearColor(0x000000, 0);
  return renderer;
}

export class ThreeOffscreenRenderer {
  readonly renderer: THREE.WebGLRenderer;
  private readonly gl: OffscreenGlRenderer;
  private readonly sizeTarget = new THREE.Vector2();

  constructor(gl?: OffscreenGlRenderer) {
    this.gl = gl ?? createWebGLRenderer();
    this.renderer = this.gl as THREE.WebGLRenderer;
  }

  render({ canvas, scene, camera, width, height, draw }: OffscreenRenderRequest): void {
    const { gl } = this;
    // `setSize` always reassigns canvas.width/height, which clears and reallocates the drawing
    // buffer even when the size is unchanged. Only call it when the real drawing-buffer size
    // differs: `getSize` catches an EffectComposer, `domElement.width` catches an external resize.
    gl.getSize(this.sizeTarget);
    if (
      this.sizeTarget.x !== width ||
      this.sizeTarget.y !== height ||
      gl.domElement.width !== width ||
      gl.domElement.height !== height
    ) {
      gl.setSize(width, height, false);
    }
    gl.setViewport(0, 0, width, height);
    if (draw) draw(this.renderer);
    else gl.render(scene, camera);

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('model3d: 2D canvas context unavailable');
    }
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(gl.domElement, 0, 0, width, height);
  }

  dispose(): void {
    this.gl.dispose();
    this.gl.forceContextLoss();
  }
}

/**
 * Reference-counted pool of shared things keyed by owner (a Pixi `Application`).
 *
 * The last release schedules disposal after a grace period, so a StrictMode double-mount or a
 * stage remount reuses the same renderer instead of tearing down and recreating a WebGL context.
 * Without this, every Application (each story switch, for example) leaked a context until the
 * browser's ~16 context cap started dropping live ones.
 */
export function createRendererPool<T extends { dispose(): void }>(
  create: () => T,
  graceMs = 2_000,
) {
  const entries = new Map<
    unknown,
    { value: T; users: number; timer: ReturnType<typeof setTimeout> | null }
  >();
  return {
    acquire(owner: unknown): T {
      let entry = entries.get(owner);
      if (!entry) {
        entry = { value: create(), users: 0, timer: null };
        entries.set(owner, entry);
      }
      if (entry.timer) {
        clearTimeout(entry.timer);
        entry.timer = null;
      }
      entry.users += 1;
      return entry.value;
    },
    release(owner: unknown): void {
      const entry = entries.get(owner);
      if (!entry) return;
      entry.users = Math.max(0, entry.users - 1);
      if (entry.users > 0 || entry.timer) return;
      entry.timer = setTimeout(() => {
        if (entry.users > 0) return;
        entries.delete(owner);
        try {
          entry.value.dispose();
        } catch {
          /* context may already be lost */
        }
      }, graceMs);
    },
    size: () => entries.size,
  };
}

type RendererFactory = () => ThreeOffscreenRenderer;

let rendererFactoryOverride: RendererFactory | null = null;

/**
 * Test hook: replace how the shared pool builds its renderer, so `ThreeNode` unit tests can inject a
 * fake `OffscreenGlRenderer` (jsdom has no WebGL). Pass `null` to restore the real renderer.
 */
export function setOffscreenRendererFactoryForTests(factory: RendererFactory | null): void {
  rendererFactoryOverride = factory;
}

const FALLBACK_OWNER = {};
const pool = createRendererPool<ThreeOffscreenRenderer>(() =>
  rendererFactoryOverride ? rendererFactoryOverride() : new ThreeOffscreenRenderer(),
);

/** Number of live pooled renderers (tests; a released one leaves after the grace period). */
export function debugRendererCount(): number {
  return pool.size();
}

/**
 * Take a use of the shared renderer for a Pixi `Application` (or a process-wide fallback when no
 * application is available, e.g. in tests/portals). Pair every call with `releaseOffscreenRenderer`.
 */
export function acquireOffscreenRenderer(app?: object | null): ThreeOffscreenRenderer {
  return pool.acquire(app ?? FALLBACK_OWNER);
}

export function releaseOffscreenRenderer(app?: object | null): void {
  pool.release(app ?? FALLBACK_OWNER);
}
