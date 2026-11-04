import { DEFAULT_Z, ROLE_KINDS, TEXT_DEFAULTS } from './constants';
import { applyCameraIfSet } from './camera';
import { AuthoringError, hintList } from './errors';
import { layerMeta, readDirector, sceneMeta, writeDirector } from './meta';
import { boxToImageTransform, boxToShape, boxToText, defaultBox, fitRect, textSize, type Rect } from './placement';
import type { Comp, LayerRole, Obj, StyleArg } from './types';

export interface AddLayerOptions {
  sceneId: string;
  role: LayerRole;
  kind: 'image' | 'video' | 'text' | 'shape';
  assetId?: string;
  text?: string;
  style?: StyleArg;
  fill?: string;
  box?: Rect;
  z?: number;
}

const precomp = (c: Comp, sceneId: string): Obj => (c.precomps as Record<string, Obj>)[sceneId]!;
const MAX_TEXT = 120;

function checkText(text: string | undefined): string {
  if (!text || !text.trim()) throw new AuthoringError('bad_value', 'text must not be empty');
  if (text.length > MAX_TEXT) throw new AuthoringError('bad_value', `text is ${text.length} characters; the limit is ${MAX_TEXT}`);
  return text;
}

function textStyle(base: Obj, s?: StyleArg): Obj {
  const out = { ...base };
  if (!s) return out;
  if (s.font !== undefined) out.font = s.font;
  if (s.size !== undefined) out.size = s.size;
  if (s.color !== undefined) out.fill = s.color;
  if (s.weight !== undefined) out.weight = s.weight;
  if (s.align !== undefined) out.align = s.align;
  if (s.boxWidth !== undefined) out.boxWidth = s.boxWidth;
  return out;
}

/** Insert keeping the scene's layers sorted by z descending (farthest first); a new layer goes after existing layers of equal z. */
function insertByZ(layers: Obj[], layer: Obj, z: number, zOf: (id: string) => number): void {
  let i = layers.length;
  while (i > 0 && zOf(layers[i - 1]!.id) < z) i--;
  layers.splice(i, 0, layer);
}

export function addLayer(c: Comp, o: AddLayerOptions): Comp {
  const sm = sceneMeta(c, o.sceneId);
  const allowed = ROLE_KINDS[o.role] ?? [];
  if (!allowed.includes(o.kind)) {
    throw new AuthoringError('invalid_role_kind', `role '${o.role}' cannot be a '${o.kind}' layer`, `Allowed kinds for ${o.role}: ${allowed.join(', ') || 'none'}`);
  }
  const out = structuredClone(c);
  const p = precomp(out, o.sceneId);
  const frames = sm.durationFrames;
  const meta = readDirector(out);

  let id = `${o.sceneId}:${o.role}`;
  for (let n = 2; (p.layers as Obj[]).some((l) => l.id === id); n++) id = `${o.sceneId}:${o.role}-${n}`;

  const base = { id, name: o.role, inPoint: 0, outPoint: frames };
  let layer: Obj;
  const W = out.width;
  const H = out.height;

  if (o.kind === 'image' || o.kind === 'video') {
    const a = o.assetId ? out.assets[o.assetId] : undefined;
    if (!o.assetId || !a) throw new AuthoringError('unknown_asset', `asset '${String(o.assetId)}' is not registered`, hintList(Object.keys(out.assets)));
    p.assets[o.assetId] = structuredClone(a); // the engine resolves a layer's asset in its own comp
    const size = { width: a.width ?? W, height: a.height ?? H };
    const rect = o.box ?? fitRect(size, defaultBox(o.role, W, H), o.role === 'bg' || o.role === 'clip' ? 'cover' : 'contain');
    const t = boxToImageTransform(size, rect);
    layer = {
      kind: o.kind, ...base, assetId: o.assetId, ...(o.kind === 'video' ? { muted: false } : {}),
      transform: { position: t.position, anchor: t.anchor, scale: t.scale, rotation: 0, opacity: 1 },
    };
  } else if (o.kind === 'shape') {
    const t = boxToShape(o.box ?? defaultBox(o.role, W, H));
    layer = {
      kind: 'shape', ...base, path: { kind: 'rect', size: t.size }, fill: o.fill ?? '#000000',
      transform: { position: t.position, anchor: t.anchor, scale: [1, 1], rotation: 0, opacity: 1 },
    };
  } else {
    const text = checkText(o.text);
    const rect = o.box ?? defaultBox(o.role, W, H);
    const t = boxToText(rect, W, H);
    const style = textStyle(
      { font: TEXT_DEFAULTS.font, size: textSize(o.role as 'headline' | 'caption', H), fill: TEXT_DEFAULTS.fill, weight: TEXT_DEFAULTS.weight, align: TEXT_DEFAULTS.align, boxWidth: t.boxWidth },
      o.style,
    );
    layer = { kind: 'text', ...base, source: text, style, transform: { position: t.position, anchor: t.anchor, scale: [1, 1], rotation: 0, opacity: 1 } };
  }

  const z = o.z ?? DEFAULT_Z[o.role] ?? 0;
  meta.layers[id] = { sceneId: o.sceneId, role: o.role, ...(o.assetId ? { assetId: o.assetId } : {}), z };
  insertByZ(p.layers, layer, z, (lid) => meta.layers[lid]?.z ?? 0);
  return applyCameraIfSet(writeDirector(out, meta), o.sceneId);
}

export function setText(c: Comp, layerId: string, text: string, style?: StyleArg): Comp {
  const lm = layerMeta(c, layerId);
  const out = structuredClone(c);
  const layer = (precomp(out, lm.sceneId).layers as Obj[]).find((l) => l.id === layerId);
  if (!layer) throw new AuthoringError('unknown_layer', `no layer '${layerId}'`);
  if (layer.kind !== 'text') throw new AuthoringError('invalid_role_kind', `layer '${layerId}' is a ${layer.kind} layer, not text`);
  layer.source = checkText(text);
  layer.style = textStyle(layer.style, style);
  return out;
}

function findLayer(c: Comp, layerId: string): { sceneId: string } {
  const meta = readDirector(c);
  const lm = meta.layers[layerId];
  if (lm) return { sceneId: lm.sceneId };
  const prefix = layerId.split(':')[0]!;
  const ids = meta.scenes[prefix] ? Object.keys(meta.layers).filter((k) => meta.layers[k]!.sceneId === prefix) : Object.keys(meta.layers);
  throw new AuthoringError('unknown_layer', `no layer '${layerId}'`, hintList(ids));
}

export function removeLayer(c: Comp, layerId: string): Comp {
  const { sceneId } = findLayer(c, layerId);
  const out = structuredClone(c);
  const p = precomp(out, sceneId);
  const meta = readDirector(out);
  const assetId = meta.layers[layerId]?.assetId;
  p.layers = (p.layers as Obj[]).filter((l) => l.id !== layerId);
  delete meta.layers[layerId];
  if (assetId && !(p.layers as Obj[]).some((l) => l.assetId === assetId)) delete p.assets[assetId];
  return applyCameraIfSet(writeDirector(out, meta), sceneId);
}

export function reorderLayer(c: Comp, layerId: string, to: 'front' | 'back' | { above: string } | { below: string }): Comp {
  const { sceneId } = findLayer(c, layerId);
  const meta = readDirector(c);
  const sceneLayers = Object.entries(meta.layers).filter(([, m]) => m.sceneId === sceneId);
  const zs = sceneLayers.map(([, m]) => m.z ?? 0);
  let z: number;
  if (to === 'front') z = Math.min(...zs) - 1;
  else if (to === 'back') z = Math.max(...zs) + 1;
  else {
    const ref = 'above' in to ? to.above : to.below;
    const rm = meta.layers[ref];
    if (!rm || rm.sceneId !== sceneId) throw new AuthoringError('bad_value', `reference layer '${ref}' is not in scene '${sceneId}'`, hintList(sceneLayers.map(([id]) => id)));
    z = (rm.z ?? 0) + ('above' in to ? -0.01 : 0.01);
  }
  z = Math.round(z * 100) / 100;
  meta.layers[layerId]!.z = z;
  const out = structuredClone(c);
  const p = precomp(out, sceneId);
  const order = new Map((p.layers as Obj[]).map((l, i) => [l.id as string, i]));
  p.layers = [...(p.layers as Obj[])].sort((a, b) => (meta.layers[b.id]?.z ?? 0) - (meta.layers[a.id]?.z ?? 0) || order.get(a.id)! - order.get(b.id)!);
  return writeDirector(out, meta);
}

export function setLayerHidden(c: Comp, layerId: string, hidden: boolean): Comp {
  const { sceneId } = findLayer(c, layerId);
  const out = structuredClone(c);
  const layer = (precomp(out, sceneId).layers as Obj[]).find((l) => l.id === layerId)!;
  if (hidden) layer.hidden = true;
  else delete layer.hidden;
  return out;
}
