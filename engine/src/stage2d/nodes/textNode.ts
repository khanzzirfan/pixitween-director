import * as THREE from 'three';
import type { TargetRef } from '../../core/paths';
import { configure2DMaterial } from '../../core/stage';
import { applyBaseTransform, applyBlendMode, createLayerObjects, resolveBaseTarget } from '../../core/transform';
import type { MotionNode, NodeFactory } from '../../core/types';
import type { TextLayer } from '../../schema';
import { drawText } from '../text/draw';
import { cssFont, layoutTextLines, textPadding, type Measure } from '../text/layout';

// textNode (engine/docs/03-stage-2d.md): text drawn on a 2D canvas at `PIXEL_RATIO`, wrapped in a
// `CanvasTexture` on a `Mesh(PlaneGeometry)`. The plane includes the style's padding (stroke width /
// shadow reach) on every side so nothing is clipped, but `size()` reports the inner (unpadded) box —
// the two share a center, so the existing anchor math (`applyBaseTransform`) needs no change.

const PIXEL_RATIO = 2;

function firstFamily(fontFamily: string): string {
  return fontFamily.split(',')[0].trim();
}

function createMeasure(ctx: CanvasRenderingContext2D): Measure {
  return (text, font, letterSpacing) => {
    ctx.font = font;
    ctx.letterSpacing = `${letterSpacing}px`;
    return ctx.measureText(text).width;
  };
}

export const createTextNode: NodeFactory = (layer, _ctx, parentStart) => {
  if (layer.type !== 'text') {
    throw new Error(`motion: createTextNode expects a text layer, got ${layer.type}`);
  }
  return buildTextNode(layer, parentStart);
};

function buildTextNode(layer: TextLayer, parentStart: number): MotionNode {
  const start = parentStart + layer.start;
  const end = parentStart + (layer.end ?? layer.start);
  const alpha = { value: layer.alpha };
  const warnings: string[] = [];

  const { display, content } = createLayerObjects(layer);
  const style = { ...layer.style };

  let size = { width: 0, height: 0 };
  let material: THREE.MeshBasicMaterial | null = null;
  let texture: THREE.CanvasTexture | null = null;

  applyBaseTransform(display, content, layer, size);

  let mesh: THREE.Mesh | null = null;

  /** Measures and draws the text; (re)builds the plane when the measured size changes. */
  const build = (ctx2d: CanvasRenderingContext2D): void => {
    const layout = layoutTextLines(layer.text, style, createMeasure(ctx2d));
    const padding = textPadding(style);
    drawText(ctx2d, layout, style, PIXEL_RATIO, padding);
    const next = { width: layout.width, height: layout.height };
    if (!mesh || next.width !== size.width || next.height !== size.height) {
      size = next;
      const geometry = new THREE.PlaneGeometry(size.width + padding * 2, size.height + padding * 2);
      geometry.translate(size.width / 2, -size.height / 2, 0);
      if (mesh) {
        mesh.geometry.dispose();
        mesh.geometry = geometry;
      } else {
        texture = new THREE.CanvasTexture(ctx2d.canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        material = new THREE.MeshBasicMaterial({ map: texture });
        configure2DMaterial(material);
        applyBlendMode(material, layer.blendMode);
        mesh = new THREE.Mesh(geometry, material);
        mesh.name = `${layer.id}:plane`;
        content.add(mesh);
      }
      applyBaseTransform(display, content, layer, size);
    }
    if (texture) texture.needsUpdate = true;
  };

  // Draw at once with whatever font is available so size() is right when the runtime builds presets;
  // redraw after the web font loads (the size usually changes by a few pixels only).
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  const syncCtx = canvas?.getContext('2d') ?? null;
  if (syncCtx) build(syncCtx);

  const ready = (async () => {
    if (typeof document !== 'undefined' && document.fonts) {
      try {
        await document.fonts.load(cssFont({ ...style, fontFamily: firstFamily(style.fontFamily) }));
      } catch {
        // Fall back to whatever the browser can render.
      }
    }
    const ctx2d = syncCtx ?? document.createElement('canvas').getContext('2d');
    if (!ctx2d) {
      throw new Error('motion: 2D canvas context unavailable for text layer');
    }
    build(ctx2d);
  })();
  ready.catch(() => {});

  function redrawFill(): void {
    if (!texture) return;
    const ctx2d = (texture.image as HTMLCanvasElement).getContext('2d');
    if (!ctx2d) return;
    const layout = layoutTextLines(layer.text, style, createMeasure(ctx2d));
    const padding = textPadding(style);
    drawText(ctx2d, layout, style, PIXEL_RATIO, padding);
    texture.needsUpdate = true;
  }

  const fillTarget: TargetRef = {
    obj: style,
    key: 'fill',
    kind: 'color',
    getColor: () => style.fill,
    setColor: (hex) => {
      style.fill = hex;
      redrawFill();
    },
  };

  const node: MotionNode = {
    id: layer.id,
    layer,
    display,
    content,
    start,
    end,
    children: [],
    alpha,
    warnings,

    size: () => size,

    resolveTarget(target, prop) {
      if (target !== undefined) return null;
      if (prop === 'fill') return fillTarget;
      return resolveBaseTarget(node, prop);
    },

    applyOpacity(effective) {
      if (material) material.opacity = effective;
    },

    ready,

    destroy() {
      mesh?.geometry.dispose();
      material?.dispose();
      texture?.dispose();
      display.removeFromParent();
    },
  };

  return node;
}
