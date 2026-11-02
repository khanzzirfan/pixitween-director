import { DEFAULT_BOX_FRACTIONS, TEXT_DEFAULTS } from './constants';
import type { LayerRole } from './types';

export type Rect = { x: number; y: number; w: number; h: number };
export type Vec2 = [number, number];

const r4 = (n: number) => Math.round(n * 1e4) / 1e4;

export function defaultBox(role: LayerRole, W: number, H: number): Rect {
  const f = DEFAULT_BOX_FRACTIONS[role] ?? DEFAULT_BOX_FRACTIONS.bg!;
  return { x: r4(f.x * W), y: r4(f.y * H), w: r4(f.w * W), h: r4(f.h * H) };
}

/** The displayed rectangle: uniform scale (min for contain, max for cover), centred in the box. Cover overflows equally on both sides. */
export function fitRect(asset: { width: number; height: number }, box: Rect, mode: 'contain' | 'cover'): Rect {
  const sx = box.w / asset.width;
  const sy = box.h / asset.height;
  const s = mode === 'contain' ? Math.min(sx, sy) : Math.max(sx, sy);
  const w = asset.width * s;
  const h = asset.height * s;
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
}

/** x,y are the TOP-LEFT of the displayed rectangle. Scale is non-uniform when the rect has another aspect. */
export function boxToImageTransform(asset: { width: number; height: number }, rect: Rect): { position: Vec2; anchor: Vec2; scale: Vec2 } {
  return {
    position: [r4(rect.x + rect.w / 2), r4(rect.y + rect.h / 2)],
    anchor: [asset.width / 2, asset.height / 2],
    scale: [r4(rect.w / asset.width), r4(rect.h / asset.height)],
  };
}

export function boxToShape(rect: Rect): { position: Vec2; anchor: Vec2; size: Vec2 } {
  return { position: [r4(rect.x + rect.w / 2), r4(rect.y + rect.h / 2)], anchor: [rect.w / 2, rect.h / 2], size: [rect.w, rect.h] };
}

/** Text anchors are the composition centre (the engine normalises it), so placement does not depend on which anchor convention wins. */
export function boxToText(rect: Rect, W: number, H: number): { position: Vec2; anchor: Vec2; boxWidth: number } {
  return { position: [r4(rect.x + rect.w / 2), r4(rect.y + rect.h / 2)], anchor: [W / 2, H / 2], boxWidth: rect.w };
}

export function textSize(role: 'headline' | 'caption', H: number): number {
  return Math.round((role === 'headline' ? TEXT_DEFAULTS.headlineSizeFraction : TEXT_DEFAULTS.captionSizeFraction) * H);
}
