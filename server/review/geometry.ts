import type { AepCompositionJson } from 'reacthub-pixitweenjs';
import type { Box } from './types';
import { GeometryError, boxArea } from './types';
import { sampleScalar, sampleVec2 } from './sample';
import { estimateTextSize } from './text-box';

type Obj = Record<string, any>;
export interface LayerBox {
  box: Box;
  position: [number, number];
  rotation: number;
  opacity: number;
  visible: boolean;
  drawIndex: number;
  size: { w: number; h: number };
}
const director = (c: AepCompositionJson) => ((c.meta as Obj | undefined)?.director ?? { scenes: {}, layers: {} }) as Obj;
export function listScenes(
  comp: AepCompositionJson,
): Array<{
  sceneId: string;
  precompId: string;
  startFrame: number;
  durationFrames: number;
  mode: 'motion' | 'generate';
  width: number;
  height: number;
  fps: number;
}> {
  const d = director(comp);
  return Object.entries(d.scenes ?? {})
    .map(([sceneId, m]: [string, any]) => {
      const p = comp.precomps?.[m.precompId] as Obj;
      return {
        sceneId,
        precompId: m.precompId,
        startFrame: m.startFrame,
        durationFrames: m.durationFrames,
        mode: m.mode,
        width: p?.width ?? comp.width,
        height: p?.height ?? comp.height,
        fps: p?.fps ?? comp.fps,
      };
    })
    .sort((a, b) => a.startFrame - b.startFrame);
}
export function sampleSceneFrames(durationFrames: number, n = 4): number[] {
  return Array.from({ length: n }, (_, i) => Math.floor(((i + 0.5) * durationFrames) / n));
}
export function layerBoxAt(
  comp: AepCompositionJson,
  layerId: string,
  frame: number,
  opts: { textSize?: (layer: Obj, scale: { sx: number; sy: number }) => { w: number; h: number } | undefined; measuredTextBox?: Box } = {},
): LayerBox {
  const d = director(comp),
    meta = d.layers?.[layerId];
  if (!meta) throw new GeometryError('unknown-layer', `unknown layer '${layerId}'`);
  const scene = d.scenes?.[meta.sceneId];
  if (!scene) throw new GeometryError('unknown-scene', `unknown scene '${meta.sceneId}'`);
  const root = (comp.layers as Obj[]).find((l) => l.id === scene.precompId || l.compId === scene.precompId);
  if (!root) throw new GeometryError('unknown-scene', `missing root scene layer '${scene.precompId}'`);
  const ident = (f: any, expected: any) => (Array.isArray(f) ? JSON.stringify(f) === JSON.stringify(expected) : f === expected);
  if (
    !ident(root.transform?.position, [0, 0]) ||
    !ident(root.transform?.anchor, [0, 0]) ||
    !ident(root.transform?.scale, [1, 1]) ||
    root.transform?.rotation !== 0 ||
    Array.isArray(root.transform?.opacity)
  )
    throw new GeometryError('precomp-transform-unsupported', 'precomp-transform-unsupported');
  const inner = comp.precomps?.[scene.precompId] as Obj;
  const layer = (inner.layers as Obj[]).find((l) => l.id === layerId);
  if (!layer) throw new GeometryError('unknown-layer', `missing layer '${layerId}'`);
  const chain: Obj[] = [layer];
  let parent = layer.parent;
  while (parent) {
    const p = (inner.layers as Obj[]).find((l) => l.id === parent);
    if (!p) break;
    chain.unshift(p);
    parent = p.parent;
  }
  let pos: [number, number] = [0, 0],
    sx = 1,
    sy = 1,
    rotation = 0,
    opacity = 1,
    visible = true;
  for (const l of chain) {
    const t = l.transform ?? {};
    const lp = sampleVec2(t.position, [0, 0], frame),
      sc = sampleVec2(t.scale, [1, 1], frame);
    const r = (sampleScalar(t.rotation, 0, frame) * Math.PI) / 180;
    const x = lp[0] * sx,
      y = lp[1] * sy;
    pos = [pos[0] + Math.cos(rotation) * x - Math.sin(rotation) * y, pos[1] + Math.sin(rotation) * x + Math.cos(rotation) * y];
    sx *= sc[0];
    sy *= sc[1];
    rotation += r;
    opacity *= sampleScalar(t.opacity, 1, frame);
    visible = visible && l.hidden !== true && l.inPoint <= frame && frame < l.outPoint;
  }
  const assets = { ...(comp.assets as Obj), ...(inner.assets as Obj) };
  let iw = inner.width,
    ih = inner.height;
  if (layer.assetId) {
    const asset = assets[layer.assetId];
    iw = asset?.width ?? iw;
    ih = asset?.height ?? ih;
  } else if (layer.kind === 'model3d') {
    // a 3D layer is its own offscreen rectangle: the viewport is its size
    iw = layer.viewport?.width ?? iw;
    ih = layer.viewport?.height ?? ih;
  }
  let w = iw * Math.abs(sx),
    h = ih * Math.abs(sy);
  if (layer.kind === 'text') {
    const measured = opts.measuredTextBox;
    if (measured)
      return {
        box: measured,
        position: pos,
        rotation: (rotation * 180) / Math.PI,
        opacity,
        visible,
        drawIndex: (inner.layers as Obj[]).indexOf(layer),
        size: { w: measured.right - measured.left, h: measured.bottom - measured.top },
      };
    const est = opts.textSize?.(layer, { sx, sy }) ?? estimateTextSize(layer);
    w = est.w * Math.abs(sx);
    h = est.h * Math.abs(sy);
  }
  const anchor = sampleVec2(layer.transform?.anchor, [0, 0], frame);
  const ax = (anchor[0] / (layer.kind === 'text' ? inner.width : iw)) * w,
    ay = (anchor[1] / (layer.kind === 'text' ? inner.height : ih)) * h;
  const left = -ax,
    top = -ay;
  const corners = [
    [left, top],
    [left + w, top],
    [left + w, top + h],
    [left, top + h],
  ].map(([x, y]) => [pos[0] + Math.cos(rotation) * x - Math.sin(rotation) * y, pos[1] + Math.sin(rotation) * x + Math.cos(rotation) * y]);
  const xs = corners.map((c) => c[0]),
    ys = corners.map((c) => c[1]);
  let box = { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
  if (layer.kind === 'model3d') {
    // the product fills 1/fit of its viewport; the rest is headroom for the shadow, so the product's own box is the viewport shrunk about its centre
    const k = 1 / (layer.camera?.fit ?? 1.3);
    const cx = (box.left + box.right) / 2;
    const cy = (box.top + box.bottom) / 2;
    const hw = ((box.right - box.left) / 2) * k;
    const hh = ((box.bottom - box.top) / 2) * k;
    box = { left: cx - hw, top: cy - hh, right: cx + hw, bottom: cy + hh };
    w *= k;
    h *= k;
  }
  return {
    box,
    position: pos,
    rotation: (rotation * 180) / Math.PI,
    opacity,
    visible,
    drawIndex: (inner.layers as Obj[]).indexOf(layer),
    size: { w, h },
  };
}
export function isProductVisible(lb: LayerBox, frameSize: { w: number; h: number }): boolean {
  if (!lb.visible || lb.opacity < 0.3 || boxArea(lb.box) <= 0) return false;
  const x = Math.max(0, Math.min(frameSize.w, lb.box.right) - Math.max(0, lb.box.left));
  const y = Math.max(0, Math.min(frameSize.h, lb.box.bottom) - Math.max(0, lb.box.top));
  return (x * y) / boxArea(lb.box) >= 0.5;
}
