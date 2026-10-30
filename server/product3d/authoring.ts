// Owned by S13a. The pure functions that put a turning 3D product into a scene, turn it and light it (design section 5.5).
// Like the rest of server/authoring, they return a new composition and throw AuthoringError on bad input.
import { AEP_VERSION } from '../authoring/constants';
import { AuthoringError, hintList } from '../authoring/errors';
import { applyCameraIfSet } from '../authoring/camera';
import { readDirector, sceneMeta, writeDirector } from '../authoring/meta';
import type { Comp, LayerMeta, Obj } from '../authoring/types';
import type { Point } from './contour';
import { BEVEL_SHARE, CAMERA, clampSway, DEFAULT_PRESET, DEPTH_SHARE, EASE_IN_OUT, KEY_LIGHT, MATERIAL, SHADOW, SWAY_DEFAULT, TILT_DEG, VIEWPORT_MAX, VIEWPORT_SCALE } from './presets';
import type { LightPreset, Model3DLayer, PrimitiveShape } from './types';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PlaceOptions {
  sceneId: string;
  /** Where the product shows, top-left corner and size, in composition pixels. */
  box: Rect;
  shape: PrimitiveShape | 'other';
  /** The wrapped label (round shapes) or the front face (boxes, pouches and extrusions): an image asset. */
  texture: { id: string; url: string; width: number; height: number; kind: 'label' | 'front' };
  /** Side colour, #rrggbb. */
  side: string;
  /** Height over width of the product. */
  aspect: number;
  /** The outline for shape 'other', in the front image's own pixels. */
  contour?: Point[];
  preset?: LightPreset;
  /** Degrees either side of the front the product turns across the scene. */
  sway?: number;
  /** Depth from the camera, like any layer; the default is the product's own. */
  z?: number;
}

const round = (n: number, d = 4) => Math.round(n * 10 ** d) / 10 ** d;
const precomp = (c: Comp, sceneId: string): Obj => (c.precomps as Record<string, Obj>)[sceneId]!;

/** The viewport: the box at twice the size, capped at 2048 on the long side, keeping the aspect. */
export function viewportFor(box: Rect): { width: number; height: number } {
  let w = box.w * VIEWPORT_SCALE;
  let h = box.h * VIEWPORT_SCALE;
  const k = Math.min(1, VIEWPORT_MAX / Math.max(w, h));
  w *= k;
  h *= k;
  return { width: Math.max(16, Math.round(w)), height: Math.max(16, Math.round(h)) };
}

const turnKeys = (frames: number, from: number, to: number, tilt: number) => [
  { t: 0, v: [tilt, from, 0] as [number, number, number], easeIn: [...EASE_IN_OUT] as [number, number, number, number], easeOut: [...EASE_IN_OUT] as [number, number, number, number] },
  { t: frames, v: [tilt, to, 0] as [number, number, number] },
];

function raiseVersion(c: Comp, sceneId: string): Comp {
  const out = structuredClone(c);
  const lt = (v: unknown) => typeof v !== 'string' || v.localeCompare(AEP_VERSION, undefined, { numeric: true }) < 0;
  if (lt(out.version)) out.version = AEP_VERSION as never;
  const p = precomp(out, sceneId);
  if (lt(p.version)) p.version = AEP_VERSION;
  return out;
}

/** Replaces the scene's 2D product layer (if any, at its place in the stack) with a model3d layer `<sceneId>:product3d` wearing the prepared textures. */
export function placeProduct3D(c: Comp, o: PlaceOptions): Comp {
  const sm = sceneMeta(c, o.sceneId);
  if (!(o.box.w > 0 && o.box.h > 0)) throw new AuthoringError('bad_value', 'box needs a positive w and h');
  if (o.shape === 'other' && (!o.contour || o.contour.length < 3)) throw new AuthoringError('bad_value', "shape 'other' needs a contour of at least 3 points");
  const sway = clampSway(o.sway ?? SWAY_DEFAULT).value;

  const out = raiseVersion(c, o.sceneId);
  const meta = readDirector(out);
  const p = precomp(out, o.sceneId);
  const id = `${o.sceneId}:product3d`;
  const old = (p.layers as Obj[]).findIndex((l) => meta.layers[l.id]?.role === 'product' || l.id === id);
  const oldMeta = old >= 0 ? meta.layers[(p.layers as Obj[])[old]!.id] : undefined;
  const z = o.z ?? oldMeta?.z ?? 1;

  // the textures live in the scene's own asset map, like every layer asset
  const asset = { type: 'image', src: o.texture.url, width: o.texture.width, height: o.texture.height };
  out.assets[o.texture.id] = structuredClone(asset) as never;
  p.assets[o.texture.id] = structuredClone(asset);

  const vp = viewportFor(o.box);
  // the product fills `box` inside the viewport with CAMERA.fit of headroom around it, so the layer is drawn at box * fit
  const scale = round((o.box.w * CAMERA.fit) / vp.width);

  const source: Model3DLayer['source'] =
    o.shape === 'other'
      ? { type: 'extrude', contour: o.contour!.map(([x, y]) => [x, y] as [number, number]), depth: round(o.texture.width * DEPTH_SHARE, 1), bevel: round(o.texture.width * BEVEL_SHARE, 1) }
      : { type: 'primitive', shape: o.shape, proportions: { width: 1, height: round(o.aspect, 3) } };

  const layer: Model3DLayer = {
    id,
    name: 'product3d',
    kind: 'model3d',
    inPoint: 0,
    outPoint: sm.durationFrames,
    transform: { position: [round(o.box.x + o.box.w / 2), round(o.box.y + o.box.h / 2)], anchor: [vp.width / 2, vp.height / 2], scale: [scale, scale], rotation: 0, opacity: 1 },
    viewport: vp,
    source,
    textures: { [o.texture.kind]: o.texture.id, side: o.side },
    material: { ...MATERIAL },
    view: { rotation: turnKeys(sm.durationFrames, -sway, sway, TILT_DEG) },
    lighting: { preset: o.preset ?? DEFAULT_PRESET, environment: 'room', key: { ...KEY_LIGHT } },
    shadow: { ...SHADOW },
    camera: { ...CAMERA },
  };

  const layers = p.layers as Obj[];
  // what the new layer replaces is kept, so a switch back to motion restores it exactly (an earlier 3D layer keeps what it had)
  const was = old >= 0 ? (meta.layers[layers[old]!.id]?.was ?? (layers[old]!.id === id ? undefined : { layer: structuredClone(layers[old]!), meta: structuredClone(meta.layers[layers[old]!.id]!) })) : undefined;
  if (old >= 0) {
    delete meta.layers[layers[old]!.id];
    layers.splice(old, 1, layer);
  } else {
    // keep the scene's layers sorted by z, farthest first; a new layer goes after existing layers of equal z
    let i = layers.length;
    while (i > 0 && (meta.layers[layers[i - 1]!.id]?.z ?? 0) < z) i--;
    layers.splice(i, 0, layer);
  }
  meta.layers[id] = { sceneId: o.sceneId, role: 'product3d', assetId: o.texture.id, z, ...(was ? { was } : {}) };
  return applyCameraIfSet(writeDirector(out, meta), o.sceneId);
}

function find3D(c: Comp, layerId: string): { sceneId: string; layer: Obj } {
  const lm = readDirector(c).layers[layerId];
  if (!lm) throw new AuthoringError('unknown_layer', `no layer '${layerId}'`, hintList(Object.keys(readDirector(c).layers)));
  const layer = (precomp(c, lm.sceneId).layers as Obj[]).find((l) => l.id === layerId);
  if (!layer || layer.kind !== 'model3d') throw new AuthoringError('not_model3d', `layer '${layerId}' is not a 3D product layer`, `Use the product3d layer, for example ${lm.sceneId}:product3d`);
  return { sceneId: lm.sceneId, layer };
}

export interface TurnOptions {
  /** Degrees about the vertical axis at the start and the end of the move; the start defaults to where it is now. */
  from?: number;
  to?: number;
  tilt?: number;
  /** 1 = across the whole scene; above 1 gets there sooner and holds; below 1 stops short. */
  speed?: number;
}

const firstKey = (r: unknown): [number, number, number] => (Array.isArray(r) && r.length && typeof r[0] === 'object' ? (r[0] as { v: [number, number, number] }).v : ((r as [number, number, number] | undefined) ?? [TILT_DEG, 0, 0]));

/** Rewrites the product's turn. Angles are clamped to 35 degrees either side of the front; `clamped` says so. */
export function turnProduct(c: Comp, layerId: string, o: TurnOptions = {}): { comp: Comp; clamped: boolean; from: number; to: number } {
  const { sceneId, layer: current } = find3D(c, layerId);
  const out = structuredClone(c);
  const layer = (precomp(out, sceneId).layers as Obj[]).find((l) => l.id === layerId)!;
  const frames = sceneMeta(out, sceneId).durationFrames;
  const before = firstKey(current.view?.rotation);
  const wantFrom = o.from ?? before[1];
  const wantTo = o.to ?? -wantFrom;
  const from = clampSway(wantFrom);
  const to = clampSway(wantTo);
  const tilt = o.tilt ?? before[0];
  const speed = Math.max(0.1, Math.min(8, o.speed ?? 1));

  let keys: Array<Record<string, unknown>>;
  if (speed > 1) {
    // arrives early and holds the end pose
    keys = [...turnKeys(Math.max(1, Math.round(frames / speed)), from.value, to.value, tilt), { t: frames, v: [tilt, to.value, 0] }];
  } else {
    // slower: the scene ends before the turn does
    keys = turnKeys(frames, from.value, from.value + (to.value - from.value) * speed, tilt);
  }
  layer.view = { ...(layer.view ?? {}), rotation: keys };
  return { comp: out, clamped: from.clamped || to.clamped, from: from.value, to: to.value };
}

export interface LightOptions {
  preset?: LightPreset;
  azimuth?: number;
  elevation?: number;
  intensity?: number;
}

/** Sets the light: a preset, and/or the key light's angle and strength. The turn and everything else stay as they were. */
export function lightProduct(c: Comp, layerId: string, o: LightOptions): Comp {
  const { sceneId } = find3D(c, layerId);
  const out = structuredClone(c);
  const layer = (precomp(out, sceneId).layers as Obj[]).find((l) => l.id === layerId)!;
  const lighting: Obj = { ...(layer.lighting ?? {}) };
  if (o.preset) lighting.preset = o.preset;
  if (o.azimuth !== undefined || o.elevation !== undefined || o.intensity !== undefined) {
    lighting.key = {
      ...(lighting.key ?? {}),
      ...(o.azimuth !== undefined ? { azimuth: o.azimuth } : {}),
      ...(o.elevation !== undefined ? { elevation: o.elevation } : {}),
      ...(o.intensity !== undefined ? { intensity: Math.max(0, o.intensity) } : {}),
    };
  }
  layer.lighting = lighting;
  return out;
}

/** Whether the scene shows its product as a 3D layer. */
export const has3D = (c: Comp, sceneId: string): boolean => !!readDirector(c).layers[`${sceneId}:product3d`] && !!(precomp(c, sceneId)?.layers as Obj[] | undefined)?.some((l) => l.kind === 'model3d');

/**
 * Puts the 2D product back where the 3D layer is: the layer and its meta exactly as they were before placeProduct3D.
 * A 3D layer that never replaced a 2D one (it was built straight in 3D) gets a plain product image layer over the same box.
 */
export function unplaceProduct3D(c: Comp, sceneId: string, fallback?: { assetId: string; url: string; width: number; height: number }): Comp {
  const id = `${sceneId}:product3d`;
  const meta = readDirector(c);
  const lm = meta.layers[id];
  if (!lm) throw new AuthoringError('unknown_layer', `no layer '${id}'`, hintList(Object.keys(meta.layers)));
  const out = structuredClone(c);
  const p = precomp(out, sceneId);
  const layers = p.layers as Obj[];
  const at = layers.findIndex((l) => l.id === id);
  if (at < 0 || layers[at]!.kind !== 'model3d') throw new AuthoringError('not_model3d', `layer '${id}' is not a 3D product layer`);
  const three = layers[at]!;

  let back: Obj;
  let backMeta: Omit<LayerMeta, 'was'>;
  if (lm.was) {
    back = structuredClone(lm.was.layer);
    backMeta = structuredClone(lm.was.meta);
  } else {
    if (!fallback) throw new AuthoringError('bad_value', 'there is no 2D product to restore and no photo to build one from');
    const [vw, vh] = [three.viewport.width, three.viewport.height];
    const s = three.transform.scale as [number, number];
    const w = (vw * s[0]) / (three.camera?.fit ?? 1.3);
    const h = (vh * s[1]) / (three.camera?.fit ?? 1.3);
    const pos = three.transform.position as [number, number];
    out.assets[fallback.assetId] ??= { type: 'image', src: fallback.url, width: fallback.width, height: fallback.height } as never;
    p.assets[fallback.assetId] ??= { type: 'image', src: fallback.url, width: fallback.width, height: fallback.height };
    back = {
      kind: 'image', id: `${sceneId}:product`, name: 'product', inPoint: 0, outPoint: three.outPoint, assetId: fallback.assetId,
      transform: { position: [pos[0], pos[1]], anchor: [fallback.width / 2, fallback.height / 2], scale: [round(w / fallback.width), round(h / fallback.height)], rotation: 0, opacity: 1 },
    };
    backMeta = { sceneId, role: 'product', assetId: fallback.assetId, z: lm.z ?? 1 };
  }
  layers.splice(at, 1, back);
  delete meta.layers[id];
  meta.layers[back.id] = backMeta;
  // the label or front texture was only for the 3D layer
  const used = new Set<string>();
  for (const l of layers) {
    if (l.assetId) used.add(l.assetId);
    for (const k of ['label', 'front'] as const) if (l.textures?.[k]) used.add(l.textures[k]);
  }
  for (const key of ['label', 'front'] as const) {
    const tid = three.textures?.[key];
    if (tid && !used.has(tid)) delete p.assets[tid];
  }
  return writeDirector(out, meta);
}
