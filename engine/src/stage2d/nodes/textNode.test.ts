import type * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NodeContext } from '../../core/types';
import { TextLayerSchema } from '../../schema/layers2d';
import { createTextNode } from './textNode';

function fakeContext(): CanvasRenderingContext2D {
  return {
    canvas: { width: 0, height: 0 },
    font: '',
    letterSpacing: '0px',
    textBaseline: 'alphabetic',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    lineJoin: 'miter',
    shadowColor: '',
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    clearRect: vi.fn(),
    setTransform: vi.fn(),
    measureText: vi.fn((text: string) => ({ width: text.length * 10 })),
    fillText: vi.fn(),
    strokeText: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
}

function context(): NodeContext {
  return { doc: { layers: [] } as never, textures: new Map(), renderer: null };
}

function meshOf(node: ReturnType<typeof createTextNode>): THREE.Mesh {
  return node.content.children[0] as THREE.Mesh;
}

describe('createTextNode', () => {
  let ctx: CanvasRenderingContext2D;

  beforeEach(() => {
    ctx = fakeContext();
    const getContext = function (this: HTMLCanvasElement) {
      (ctx as unknown as { canvas: HTMLCanvasElement }).canvas = this;
      return ctx;
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(getContext as unknown as typeof HTMLCanvasElement.prototype.getContext);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('knows its size before ready, and draws again after the font loads', async () => {
    const layer = TextLayerSchema.parse({ id: 'a', type: 'text', text: 'Hi', style: { fontSize: 50 } });
    const node = createTextNode(layer, context(), 0);
    // Presets read size() when the runtime assembles, before fonts load.
    expect(node.size()).toEqual({ width: 20, height: 60 });
    await node.ready;

    expect(node.size()).toEqual({ width: 20, height: 60 });
    expect(ctx.fillText).toHaveBeenCalledTimes(2);
    expect((ctx.fillText as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe('Hi');
  });

  it('strokes before filling and widens the plane by twice the stroke width', async () => {
    const layer = TextLayerSchema.parse({
      id: 'a',
      type: 'text',
      text: 'Hi',
      style: { fontSize: 50, stroke: { color: '#000000', width: 4 } },
    });
    const node = createTextNode(layer, context(), 0);
    await node.ready;

    const strokeOrder = (ctx.strokeText as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    const fillOrder = (ctx.fillText as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    expect(strokeOrder).toBeLessThan(fillOrder);

    const geometry = meshOf(node).geometry as THREE.PlaneGeometry;
    expect(geometry.parameters.width).toBe(node.size().width + 8);
  });

  it('redraws the fill via resolveTarget(undefined, "fill") and bumps the texture version', async () => {
    const layer = TextLayerSchema.parse({ id: 'a', type: 'text', text: 'Hi', style: { fontSize: 50 } });
    const node = createTextNode(layer, context(), 0);
    await node.ready;

    const material = meshOf(node).material as THREE.MeshBasicMaterial;
    const texture = material.map as THREE.CanvasTexture;
    const versionBefore = texture.version;

    const target = node.resolveTarget(undefined, 'fill');
    expect(target).not.toBeNull();
    const before = (ctx.fillText as ReturnType<typeof vi.fn>).mock.calls.length;
    target!.setColor!('#ff0000');

    expect(ctx.fillText).toHaveBeenCalledTimes(before + 1);
    expect(ctx.fillStyle).toBe('#ff0000');
    expect(texture.version).toBeGreaterThan(versionBefore);
  });

  it('still resolves and draws with the fallback when document.fonts is missing', async () => {
    const original = document.fonts;
    // @ts-expect-error -- simulate an environment without the Font Loading API
    delete document.fonts;
    try {
      const layer = TextLayerSchema.parse({ id: 'a', type: 'text', text: 'Hi', style: { fontSize: 50 } });
      const node = createTextNode(layer, context(), 0);
      await expect(node.ready).resolves.toBeUndefined();
      expect(node.size()).toEqual({ width: 20, height: 60 });
    } finally {
      Object.defineProperty(document, 'fonts', { value: original, configurable: true });
    }
  });
});
