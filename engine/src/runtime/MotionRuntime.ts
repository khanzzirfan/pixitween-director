import * as THREE from 'three';
import { disposeTextures, loadImageTextures } from '../stage2d/textures';
import { createThreeNode, preloadThreeAssets } from '../three';
import type { PreloadedThreeAssets } from '../three/build/scene';
import { parseMotionDoc, type Layer, type MotionDoc, type MotionDocError, type MotionDocInput } from '../schema';
import type { ThreeLayer } from '../schema/layer3d';
import { assemble, type Assembly } from './assemble';

// MotionRuntime (engine/docs/06-runtime-player.md, "MotionRuntime"): the one object that owns the
// canvas and the single WebGLRenderer, and plays a doc through `assemble`. Pages and <MotionPlayer>
// stay thin wrappers around this.

import { pickNode } from './pick';
import { passTargetsFromNodes, type PassTarget } from './capture';

export interface LayerError {
  layerId: string;
  message: string;
}

export type LoadResult = { ok: true; warnings: string[] } | { ok: false; errors: MotionDocError[] };

export interface MotionRuntimeOptions {
  mount: HTMLElement;
  displayWidth?: number;
  loop?: boolean;
  onError?(error: unknown): void;
  /** Injectable for tests; defaults to a real `THREE.WebGLRenderer`. */
  rendererFactory?: (params: THREE.WebGLRendererParameters) => THREE.WebGLRenderer;
}

function defaultRendererFactory(params: THREE.WebGLRendererParameters): THREE.WebGLRenderer {
  return new THREE.WebGLRenderer(params);
}

function flattenLayers(layers: Layer[]): Layer[] {
  return layers.flatMap((layer) => (layer.type === 'group' ? [layer, ...flattenLayers(layer.children)] : [layer]));
}

export class MotionRuntime {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly loop: boolean;
  private readonly onError?: (error: unknown) => void;

  private doc: MotionDoc | null = null;
  private assembly: Assembly | null = null;
  private textures = new Map<string, THREE.Texture>();
  private errors: LayerError[] = [];

  private constructor(opts: MotionRuntimeOptions) {
    this.loop = opts.loop ?? false;
    this.onError = opts.onError;

    const rendererFactory = opts.rendererFactory ?? defaultRendererFactory;
    this.renderer = rendererFactory({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    if (opts.displayWidth !== undefined) {
      this.renderer.domElement.style.width = `${opts.displayWidth}px`;
      this.renderer.domElement.style.height = 'auto';
    }

    opts.mount.appendChild(this.renderer.domElement);
  }

  static create(opts: MotionRuntimeOptions): MotionRuntime {
    return new MotionRuntime(opts);
  }

  async load(input: unknown): Promise<LoadResult> {
    const result = parseMotionDoc(input as MotionDocInput);
    if (!result.ok) return { ok: false, errors: result.errors };

    const doc = result.doc;

    this.assembly?.destroy();
    this.assembly = null;
    disposeTextures(this.textures);
    this.textures = new Map();
    this.errors = [];

    try {
      const { textures } = await loadImageTextures(doc);
      this.textures = textures;

      const threeLayers = flattenLayers(doc.layers).filter((layer): layer is ThreeLayer => layer.type === 'three');
      const preloadedByLayer = new Map<string, PreloadedThreeAssets>();
      await Promise.all(
        threeLayers.map(async (layer) => {
          const preloaded = await preloadThreeAssets(layer, doc);
          preloadedByLayer.set(layer.id, preloaded);
          for (const error of preloaded.errors) {
            this.errors.push({ layerId: layer.id, message: String(error.error) });
          }
        }),
      );

      this.renderer.setSize(doc.width, doc.height, false);

      const assembly = assemble(doc, { renderer: this.renderer, textures, factories: { three: createThreeNode }, preloaded: preloadedByLayer });
      for (const node of assembly.nodes) {
        node.ready
          .catch((error: unknown) => {
            this.errors.push({ layerId: node.id, message: error instanceof Error ? error.message : String(error) });
            this.onError?.(error);
          })
          // A node that finished loading (textures, glTF, fonts) draws nothing until the next render, so
          // redraw the current time; otherwise the first frame stays blank until a seek or play.
          .finally(() => {
            if (this.assembly === assembly) assembly.renderAt(assembly.clock.time);
          });
      }

      this.doc = doc;
      this.assembly = assembly;
      return { ok: true, warnings: assembly.warnings };
    } catch (error) {
      this.onError?.(error);
      throw error;
    }
  }

  play(): void {
    this.assembly?.clock.play();
  }

  pause(): void {
    this.assembly?.clock.pause();
  }

  seek(sec: number): void {
    this.assembly?.clock.seek(sec);
  }

  getTime(): number {
    return this.assembly?.clock.time ?? 0;
  }

  getDuration(): number {
    return this.assembly?.clock.duration ?? 0;
  }

  getCanvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  /** Resolves true once every node's `ready` has settled without error, false on error or timeout. */
  async whenReady(timeoutSec: number): Promise<boolean> {
    const nodes = this.assembly?.nodes ?? [];
    if (nodes.length === 0) return true;

    let timedOut = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        resolve();
      }, timeoutSec * 1000);
    });

    const settled = Promise.allSettled(nodes.map((node) => node.ready));
    const outcome = await Promise.race([settled, timeout]);
    clearTimeout(timeoutHandle);

    if (timedOut) return false;
    return (outcome as PromiseSettledResult<void>[]).every((result) => result.status === 'fulfilled');
  }

  async renderFrame(frame: number): Promise<HTMLCanvasElement> {
    const fps = this.doc?.fps ?? 30;
    this.seek(frame / fps);
    return this.getCanvas();
  }

  getFps(): number {
    return this.doc?.fps ?? 30;
  }

  getDoc(): MotionDoc | null {
    return this.doc;
  }

  getRenderer(): THREE.WebGLRenderer {
    return this.renderer;
  }

  /** Visible three layers at the current time, for depth and normal passes. */
  passTargets(): PassTarget[] {
    return passTargetsFromNodes(this.assembly?.nodes ?? []);
  }

  /** Redraws the current time through the normal pipeline. */
  redraw(): void {
    if (this.assembly) this.assembly.renderAt(this.assembly.clock.time);
  }

  readPixel(x: number, y: number): [number, number, number, number] {
    const canvas = this.renderer.domElement;
    const gl = this.renderer.getContext();
    const out = new Uint8Array(4);
    gl.readPixels(x, canvas.height - 1 - y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
    return [out[0], out[1], out[2], out[3]];
  }

  /** Front-most layer id at a doc-space pixel (y down), or null. */
  pick(x: number, y: number): string | null {
    return pickNode(this.assembly?.nodes ?? [], x, y);
  }

  layerErrors(): LayerError[] {
    return [...this.errors];
  }

  destroy(): void {
    this.assembly?.destroy();
    this.assembly = null;
    disposeTextures(this.textures);
    this.textures = new Map();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
