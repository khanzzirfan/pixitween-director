// Deterministic text lane (S12f): the crew's one owner for where text rests and how it is set.
import type { StyleBible } from '@shared/crew';
import { BIBLE_FONT_STACKS } from '../authoring/constants';
import type { Comp, Obj } from '../authoring/types';
import { listScenes, layerBoxAt } from '../review/geometry';
import { sampleSceneFrames } from '../review/geometry';
import { isAnimated, type Kf } from '../authoring/keyframes';
import { textSize } from '../authoring/placement';
import { estimateTextSize } from '../review/text-box';
import { boxArea, intersect, type Box } from '../review/types';
import { bestFlatTextColor, parseColor, ratioFromLuminance, relLuminance } from '../review/contrast';
import { readDirector } from '../authoring/meta';

const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
const precompOf = (c: Comp, sceneId: string): Obj | undefined => {
  const scene = listScenes(c).find((s) => s.sceneId === sceneId);
  return scene ? ((c.precomps as Record<string, Obj> | undefined)?.[scene.precompId] ?? undefined) : undefined;
};
const textLayers = (c: Comp, sceneId: string): Obj[] => ((precompOf(c, sceneId)?.layers ?? []) as Obj[]).filter((l) => l.kind === 'text');

/** Frames at or after the layer's last position, scale or opacity keyframe; all samples when it has none. */
export function restFrames(layer: Obj, samples: readonly number[]): number[] {
  const t = layer.transform ?? {};
  const last = [t.position, t.scale, t.opacity]
    .filter(isAnimated)
    .flatMap((field) => (field as Kf<unknown>[]).map((k) => k.t));
  if (!last.length) return [...samples];
  const after = samples.filter((f) => f >= Math.max(...last));
  return after.length ? after : [samples[samples.length - 1]!];
}

/** The first frame where the text rests; used by both R2 and the lane. */
export function restFrame(layer: Obj, durationFrames: number, boxAt?: (frame: number) => { visible: boolean; opacity: number }): number {
  const samples = sampleSceneFrames(durationFrames, 4);
  const rest = restFrames(layer, samples);
  const visible = (f: number) => !boxAt || (boxAt(f).visible && boxAt(f).opacity >= 0.3);
  const pick = rest.find(visible);
  if (pick !== undefined) return pick;
  const lastVisible = [...samples].reverse().find(visible);
  return lastVisible ?? rest[0] ?? samples[0]!;
}

const caseText = (text: string, mode: StyleBible['type']['case']): string => {
  if (mode === 'upper') return text.toUpperCase();
  if (mode === 'title') return text.replace(/\S+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
  return text.charAt(0).toUpperCase() + text.slice(1);
};

/** Applies the bible's stack, weight and case to every text layer in the scene. Pure and idempotent. */
export function applyTextLane(comp: Comp, sceneId: string, bible: StyleBible): Comp {
  const layers = textLayers(comp, sceneId);
  if (!layers.length) return comp;
  const next = structuredClone(comp) as Comp;
  let changed = false;
  for (const layer of textLayers(next, sceneId)) {
    const role = layer.name === 'caption' ? 'caption' : 'headline';
    const weight = role === 'caption' ? Math.max(300, bible.type.weight - 200) : bible.type.weight;
    const stack = BIBLE_FONT_STACKS[bible.type.font];
    const source = typeof layer.source === 'string' ? layer.source : undefined;
    if (source !== undefined) {
      const cased = caseText(source, bible.type.case);
      if (cased !== source) {
        layer.source = cased;
        changed = true;
      }
    }
    if (layer.style?.font !== stack) {
      layer.style = { ...layer.style, font: stack };
      changed = true;
    }
    if (layer.style?.weight !== weight) {
      layer.style = { ...layer.style, weight };
      changed = true;
    }
  }
  return changed ? next : comp;
}

export interface TextMove {
  layerId: string;
  dx: number;
  dy: number;
  boxWidth?: number;
  size?: number;
}

const shiftPosition = (layer: Obj, dx: number, dy: number): void => {
  const position = layer.transform?.position;
  if (Array.isArray(position) && position.length && typeof position[0] === 'object' && position[0] !== null) {
    layer.transform.position = (position as Kf<[number, number]>[]).map((k) => ({ ...k, v: [r4(k.v[0] + dx), r4(k.v[1] + dy)] }));
  } else if (Array.isArray(position) && typeof position[0] === 'number') {
    layer.transform.position = [r4((position as number[])[0]! + dx), r4((position as number[])[1]! + dy)];
  }
};

const overflow = (box: Box, safe: Box): { dx: number; dy: number } => ({
  dx: box.left < safe.left ? safe.left - box.left : box.right > safe.right ? safe.right - box.right : 0,
  dy: box.top < safe.top ? safe.top - box.top : box.bottom > safe.bottom ? safe.bottom - box.bottom : 0,
});

/** Fits every text layer's rest box inside the safe rect, shifting all position keyframes by the same delta. */
export function fitTextToSafeArea(comp: Comp, sceneId: string, o: { inset?: number; margin?: number } = {}): { comp: Comp; moved: TextMove[] } {
  const scene = listScenes(comp).find((s) => s.sceneId === sceneId);
  if (!scene) return { comp, moved: [] };
  const inset = o.inset ?? 0.05;
  const margin = o.margin ?? 0.01;
  const edge = inset + margin;
  const safe: Box = { left: edge * scene.width, top: edge * scene.height, right: (1 - edge) * scene.width, bottom: (1 - edge) * scene.height };
  const safeW = safe.right - safe.left;
  const safeH = safe.bottom - safe.top;
  let working = comp;
  const moved: TextMove[] = [];

  for (const original of textLayers(comp, sceneId)) {
    let layer = textLayers(working, sceneId).find((l) => l.id === original.id);
    if (!layer) continue;
    const role = layer.name === 'caption' ? 'caption' : 'headline';
    const minSize = textSize(role, scene.height) * 0.7;
    const rest = restFrame(layer, scene.durationFrames, (f) => {
      const b = layerBoxAt(working, layer!.id, f);
      return { visible: b.visible, opacity: b.opacity };
    });
    let box = layerBoxAt(working, layer.id, rest).box;
    const before = { boxWidth: layer.style?.boxWidth as number | undefined, size: layer.style?.size as number | undefined };
    let boxWidth: number | undefined = before.boxWidth;
    let size: number | undefined = before.size;

    if (box.right - box.left > safeW) {
      boxWidth = r4(safeW);
      layer = textLayers((working = applyValue(working, sceneId, layer.id, (l) => (l.style = { ...l.style, boxWidth }))), sceneId).find((l) => l.id === layer!.id)!;
      box = layerBoxAt(working, layer.id, rest).box;
    }
    while (box.bottom - box.top > safeH) {
      const current = typeof layer.style?.size === 'number' ? layer.style.size : estimateTextSize(layer).h / 1.2;
      if (current <= minSize) break;
      const nextSize = Math.max(minSize, r4(current * 0.95));
      if (nextSize === current) break;
      size = nextSize;
      working = applyValue(working, sceneId, layer.id, (l) => (l.style = { ...l.style, size }));
      layer = textLayers(working, sceneId).find((l) => l.id === layer!.id)!;
      box = layerBoxAt(working, layer.id, rest).box;
    }

    const { dx, dy } = overflow(box, safe);
    if (dx || dy) {
      working = applyValue(working, sceneId, layer.id, (l) => shiftPosition(l, dx, dy));
      moved.push({ layerId: layer.id, dx: r4(dx), dy: r4(dy), ...(boxWidth !== before.boxWidth ? { boxWidth } : {}), ...(size !== before.size ? { size } : {}) });
    } else if (boxWidth !== before.boxWidth || size !== before.size) {
      moved.push({ layerId: layer.id, dx: 0, dy: 0, ...(boxWidth !== before.boxWidth ? { boxWidth } : {}), ...(size !== before.size ? { size } : {}) });
    }
  }
  return { comp: working, moved };
}

/** Applies one change to one layer on a fresh clone, so callers never mutate the input. */
function applyValue(comp: Comp, sceneId: string, layerId: string, change: (layer: Obj) => void): Comp {
  const next = structuredClone(comp) as Comp;
  const layer = textLayers(next, sceneId).find((l) => l.id === layerId);
  if (layer) change(layer);
  return next;
}

/** A shape that covers this share of the frame or more is a backdrop, not a box behind words. */
const BACKDROP_SHARE = 0.6;
/** The share of the words a box must cover to count as their box, and the share at which it already holds them. */
const BOX_TOUCH = 0.3;
const BOX_HOLDS = 0.9;
/** Below this opacity a box mixes with what is behind it, so its colour alone does not say how the words read. */
const BOX_SOLID = 0.6;

const maxOpacity = (op: unknown): number =>
  typeof op === 'number' ? op : Array.isArray(op) && op.length ? Math.max(...(op as Kf<number>[]).map((k) => k.v)) : 1;
const hexOf = (fill: unknown): string | undefined => {
  const raw = typeof fill === 'string' ? fill : (fill as { default?: unknown } | undefined)?.default;
  if (typeof raw !== 'string') return undefined;
  try {
    parseColor(raw);
    return raw;
  } catch {
    return undefined;
  }
};

/**
 * A box the crew drew behind words belongs to them: it shows only while they show, it holds them, and the words read on it.
 * The crew still decides whether a line gets a box and its colour; this only keeps a box from showing empty, sitting beside its
 * words, or carrying words in its own colour. A shape that no words sit on is left alone (it is part of the picture).
 */
export function settleTextBoxes(comp: Comp, sceneId: string): { comp: Comp; fixed: string[] } {
  const scene = listScenes(comp).find((s) => s.sceneId === sceneId);
  const pre = precompOf(comp, sceneId);
  if (!scene || !pre) return { comp, fixed: [] };
  const meta = readDirector(comp).layers;
  const layers = (pre.layers ?? []) as Obj[];
  const frameArea = scene.width * scene.height;
  const mid = Math.floor(scene.durationFrames / 2);
  const shapes = layers.filter((l) => {
    if (l.kind !== 'shape' || !hexOf(l.fill) || !meta[l.id] || meta[l.id]!.role === 'product') return false;
    try {
      return boxArea(layerBoxAt(comp, l.id, mid).box) < BACKDROP_SHARE * frameArea;
    } catch {
      return false;
    }
  });
  if (!shapes.length) return { comp, fixed: [] };

  // each box goes to the words it covers most (only words drawn over it)
  const pairs = new Map<string, { text: Obj; rest: number; words: Box; cover: number }>();
  for (const text of layers.filter((l) => l.kind === 'text' && meta[l.id])) {
    let rest: number;
    let words: Box;
    try {
      rest = restFrame(text, scene.durationFrames, (f) => {
        const b = layerBoxAt(comp, text.id, f);
        return { visible: b.visible, opacity: b.opacity };
      });
      words = layerBoxAt(comp, text.id, rest).box;
    } catch {
      continue;
    }
    const area = boxArea(words);
    if (!area) continue;
    for (const shape of shapes) {
      if (layers.indexOf(shape) > layers.indexOf(text)) continue;
      const over = intersect(words, layerBoxAt(comp, shape.id, rest).box);
      const cover = over ? boxArea(over) / area : 0;
      if (cover >= BOX_TOUCH && cover > (pairs.get(shape.id)?.cover ?? 0)) pairs.set(shape.id, { text, rest, words, cover });
    }
  }
  if (!pairs.size) return { comp, fixed: [] };

  const next = structuredClone(comp) as Comp;
  const nextLayers = (precompOf(next, sceneId)!.layers ?? []) as Obj[];
  const fixed: string[] = [];
  for (const [shapeId, p] of pairs) {
    const shape = nextLayers.find((l) => l.id === shapeId)!;
    const text = nextLayers.find((l) => l.id === p.text.id)!;
    const before = JSON.stringify([shape, text]);
    const peak = Math.min(1, maxOpacity(shape.transform?.opacity));
    // it shows only while the words do: their in and out, and their fade scaled to the box's own strength
    shape.inPoint = text.inPoint;
    shape.outPoint = text.outPoint;
    const fade = text.transform?.opacity;
    shape.transform.opacity = Array.isArray(fade) ? (fade as Kf<number>[]).map((k) => ({ ...k, v: r4(k.v * peak) })) : r4((typeof fade === 'number' ? fade : 1) * peak);
    // it holds the words: when they spill out of it, it is redrawn round them where they rest (still, as the words settle into it)
    if (p.cover < BOX_HOLDS) {
      const h = p.words.bottom - p.words.top;
      const padX = Math.max(scene.width * 0.025, h * 0.3);
      const padY = Math.max(scene.height * 0.008, h * 0.18);
      const w = Math.min(scene.width, p.words.right - p.words.left + padX * 2);
      const size: [number, number] = [r4(w), r4(h + padY * 2)];
      shape.path = { ...shape.path, size };
      shape.transform.anchor = [r4(size[0] / 2), r4(size[1] / 2)];
      shape.transform.position = [r4((p.words.left + p.words.right) / 2), r4((p.words.top + p.words.bottom) / 2)];
      shape.transform.scale = [1, 1];
      shape.transform.rotation = 0;
    }
    // the words read on it: when the box is solid enough, ink of the tone opposite the box
    const boxHex = hexOf(shape.fill)!;
    const ink = hexOf(text.style?.fill) ?? '#ffffff';
    const lum = relLuminance(parseColor(boxHex));
    if (peak >= BOX_SOLID && ratioFromLuminance(relLuminance(parseColor(ink)), lum) < 4.5) {
      const best = bestFlatTextColor(lum);
      if (best.ratio > ratioFromLuminance(relLuminance(parseColor(ink)), lum)) text.style = { ...text.style, fill: best.color };
    }
    if (JSON.stringify([shape, text]) !== before) fixed.push(shapeId);
  }
  return fixed.length ? { comp: next, fixed } : { comp, fixed };
}
