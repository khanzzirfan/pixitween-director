// Owned by S16b. The pure functions that write a toy-studio shot: one `stage3d` world per scene plus separate `actor3d` and `prop3d` members (engine aep-31, schema 1.11.0).
// Like the rest of server/authoring, they return a new composition and throw AuthoringError on bad input. Frames are scene frames (the scene precomp's own clock).
import { AuthoringError, hintList } from '../authoring/errors';
import { readDirector, sceneMeta, writeDirector } from '../authoring/meta';
import type { Comp, LayerRole, Obj } from '../authoring/types';

/** The schema a stage needs: stage3d, actor3d and prop3d arrived with 1.11.0, so a scene that gets a stage raises its film to it. */
const AEP_VERSION = '1.11.0';
/** The engine's per-world limits (STAGE3D_LIMITS). */
export const LIMITS = { actors: 3, props: 6, products: 1, clipsPerActor: 24 } as const;
export const DEFAULT_CAMERA = { position: [0, 1.4, 6] as [number, number, number], target: [0, 0.9, 0] as [number, number, number], fov: 35 };

type V3 = [number, number, number];
/** The framings a shot can take. Each is one locked camera; the cut between shots is where the camera "moves". */
export const SHOTS = {
  wide: { position: [0, 1.7, 7.4], target: [0, 0.9, 0], fov: 35 },
  medium: DEFAULT_CAMERA,
  close: { position: [0, 1.1, 3.6], target: [0, 0.9, 0], fov: 35 },
  low: { position: [0, 0.35, 5], target: [0, 1.1, 0], fov: 40 },
  high: { position: [0, 4, 6], target: [0, 0.5, 0], fov: 35 },
  over: { position: [2.2, 1.5, 4.5], target: [-0.3, 0.9, 0], fov: 35 },
} as const satisfies Record<string, { position: V3; target: V3; fov: number }>;
/** The painted wall is as wide as the ground: wide enough that the widest camera never sees its edge. */
const WALL_WIDTH = 16;
export type ShotSize = keyof typeof SHOTS;
export const FADE_FRAMES = 6;
export const DEFAULT_PROP_SIZE = 0.3;
/** Metres tall. A toy stage is small: nothing on it is taller than the characters. */
export const MAX_PROP_SIZE = 1.2;
export type LightPreset = 'studio' | 'window' | 'golden' | 'night';
export type LightCue = 'dawn' | 'studio' | 'spotlight' | 'night';
export type Mark = [number, number, number];

const precomp = (c: Comp, sceneId: string): Obj => (c.precomps as Record<string, Obj>)[sceneId]!;
const worldId = (sceneId: string) => `${sceneId}:world`;
const memberId = (sceneId: string, id: string) => `${sceneId}:${id}`;
const isMember = (l: Obj) => l.kind === 'actor3d' || l.kind === 'prop3d';
const T2D = (c: Comp) => ({ position: [c.width / 2, c.height / 2], anchor: [c.width / 2, c.height / 2], scale: [1, 1], rotation: 0, opacity: 1 });

function raise(c: Comp, sceneId: string): Comp {
  const out = structuredClone(c);
  const lt = (v: unknown) => typeof v !== 'string' || v.localeCompare(AEP_VERSION, undefined, { numeric: true }) < 0;
  if (lt(out.version)) out.version = AEP_VERSION as never;
  const p = precomp(out, sceneId);
  if (lt(p.version)) p.version = AEP_VERSION;
  return out;
}

function needWorld(c: Comp, sceneId: string): Obj {
  sceneMeta(c, sceneId);
  const w = (precomp(c, sceneId).layers as Obj[]).find((l) => l.id === worldId(sceneId));
  if (!w) throw new AuthoringError('unknown_layer', `scene ${sceneId} has no stage yet`, 'Call addStage first');
  return w;
}

function assetOf(c: Comp, sceneId: string, assetId: string, type: 'model' | 'image'): void {
  const a = (c.assets as Record<string, Obj>)[assetId] ?? (precomp(c, sceneId).assets as Record<string, Obj>)[assetId];
  if (!a) throw new AuthoringError('unknown_asset', `no asset '${assetId}'`, hintList(Object.keys(c.assets)));
  if (a.type !== type) throw new AuthoringError('bad_value', `asset '${assetId}' is a ${a.type}, a ${type} is needed`);
}

/** Copy a film asset into the scene's own asset map, which is where the engine looks for a scene's layers. */
function share(out: Comp, sceneId: string, assetId: string): void {
  const p = precomp(out, sceneId);
  const a = (out.assets as Record<string, Obj>)[assetId];
  if (a) p.assets[assetId] = structuredClone(a);
}

const sceneEnd = (c: Comp, sceneId: string) => sceneMeta(c, sceneId).durationFrames;

function insert(out: Comp, sceneId: string, layer: Obj, role: LayerRole, assetId?: string): void {
  const p = precomp(out, sceneId);
  const layers = p.layers as Obj[];
  const meta = readDirector(out);
  const world = layers.findIndex((l) => l.id === worldId(sceneId));
  // after the world and its members, before any 2D title layers; the world itself goes after the background
  let i: number;
  if (layer.kind === 'stage3d') {
    i = 0;
    layers.forEach((l, k) => {
      if (meta.layers[l.id]?.role === 'bg') i = k + 1;
    });
  } else {
    i = world + 1;
    while (i < layers.length && isMember(layers[i]!)) i++;
  }
  layers.splice(i, 0, layer);
  meta.layers[layer.id] = { sceneId, role, ...(assetId ? { assetId } : {}), z: layer.kind === 'stage3d' ? 5 : 5 };
  Object.assign(out, writeDirector(out, meta));
}

function replaceOrInsert(out: Comp, sceneId: string, layer: Obj, role: LayerRole, assetId?: string): void {
  const layers = precomp(out, sceneId).layers as Obj[];
  const at = layers.findIndex((l) => l.id === layer.id);
  if (at < 0) return insert(out, sceneId, layer, role, assetId);
  layers[at] = layer;
}

export interface StageOptions {
  backdropAssetId?: string;
  /** Ground colour in front of the backdrop (hex). */
  ground?: string;
  /** The framing of the locked camera (default medium). */
  shot?: ShotSize;
  lightPreset?: LightPreset;
  style?: { shading?: 'toon' | 'pbr'; toonSteps?: number; outlineWidth?: number };
}

/** One stage3d world for the scene, with the fixed camera. Calling again replaces the world's look but keeps its members. */
export function addStage(c: Comp, sceneId: string, o: StageOptions = {}): Comp {
  const sm = sceneMeta(c, sceneId);
  if (sm.mode === 'generate') throw new AuthoringError('bad_value', `scene ${sceneId} is generate-mode`);
  if (o.backdropAssetId) assetOf(c, sceneId, o.backdropAssetId, 'image');
  const cam = SHOTS[o.shot ?? 'medium'];
  const out = raise(c, sceneId);
  if (o.backdropAssetId) share(out, sceneId, o.backdropAssetId);
  const prev = (precomp(out, sceneId).layers as Obj[]).find((l) => l.id === worldId(sceneId));
  const world: Obj = {
    id: worldId(sceneId),
    name: 'World',
    kind: 'stage3d',
    inPoint: 0,
    outPoint: sm.durationFrames,
    transform: T2D(c),
    viewport: { width: c.width, height: c.height },
    camera: { position: [...cam.position], target: [...cam.target], fov: cam.fov },
    set: o.backdropAssetId ? { backdrop: o.backdropAssetId, wall: { distance: 3, height: 3.2, curve: 0.4 }, groundSize: [WALL_WIDTH, 8], ...(o.ground ? { ground: o.ground } : {}) } : { ground: o.ground ?? '#e8dcc6' },
    lights: prev?.lights ?? { preset: o.lightPreset ?? 'studio' },
    style: {
      shading: o.style?.shading ?? 'toon',
      toonSteps: o.style?.toonSteps ?? 3,
      ...(o.style?.shading === 'pbr' ? {} : { outline: { width: o.style?.outlineWidth ?? 0.012 } }),
    },
  };
  if (o.lightPreset && prev) world.lights = { ...(prev.lights as Obj), preset: o.lightPreset };
  replaceOrInsert(out, sceneId, world, 'stage3d');
  return out;
}

const round = (n: number) => Math.round(n * 1e4) / 1e4;
const checkMark = (m: Mark) => {
  if (m.length !== 3 || m.some((n) => !Number.isFinite(n))) throw new AuthoringError('bad_value', 'a mark is [x, z, facingDeg] in metres and degrees');
  if (Math.abs(m[0]) > 6 || Math.abs(m[1]) > 6) throw new AuthoringError('bad_value', 'a mark must stay within 6 m of the centre of the stage', 'Keep x and z between -6 and 6');
};
function actorOf(c: Comp, sceneId: string, actorId: string): Obj {
  const layers = precomp(c, sceneId).layers as Obj[];
  const a = layers.find((l) => l.id === memberId(sceneId, actorId) && l.kind === 'actor3d');
  if (!a) throw new AuthoringError('unknown_layer', `no actor '${actorId}' in scene ${sceneId}`, hintList(layers.filter((l) => l.kind === 'actor3d').map((l) => String(l.id).slice(sceneId.length + 1))));
  return a;
}
const count = (c: Comp, sceneId: string, kind: string, product?: boolean) =>
  (precomp(c, sceneId).layers as Obj[]).filter((l) => l.kind === kind && (product === undefined || (l.role === 'product') === product)).length;

export interface PlaceActorOptions {
  /** The frame the character walks on (default: the start of the scene). */
  inFrame?: number;
  height?: number;
  /** Idle clip name from the model's own clips; default 'Idle'. */
  idle?: string;
}

/** Adds one actor3d right after the world. `actorId` is local to the scene; the layer id is `<sceneId>:<actorId>`. */
export function placeActor(c: Comp, sceneId: string, actorId: string, assetId: string, mark: Mark, o: PlaceActorOptions = {}): Comp {
  needWorld(c, sceneId);
  assetOf(c, sceneId, assetId, 'model');
  checkMark(mark);
  const id = memberId(sceneId, actorId);
  const end = sceneEnd(c, sceneId);
  const inFrame = Math.max(0, Math.round(o.inFrame ?? 0));
  if (inFrame >= end) throw new AuthoringError('time_out_of_range', `inFrame ${inFrame} is past the end of the scene (${end} frames)`);
  const exists = (precomp(c, sceneId).layers as Obj[]).some((l) => l.id === id);
  if (!exists && count(c, sceneId, 'actor3d') >= LIMITS.actors) throw new AuthoringError('bad_value', `a stage holds at most ${LIMITS.actors} actors`);
  const out = raise(c, sceneId);
  share(out, sceneId, assetId);
  const layer: Obj = {
    id, name: actorId, kind: 'actor3d', stage: worldId(sceneId), inPoint: inFrame, outPoint: end, assetId,
    ...(o.height !== undefined ? { height: o.height } : {}),
    marks: [round(mark[0]), round(mark[1]), mark[2]],
    clips: [{ name: o.idle ?? 'Idle', startFrame: inFrame, loop: true }],
  };
  replaceOrInsert(out, sceneId, layer, 'actor3d', assetId);
  return out;
}

export interface CueOptions {
  loop?: boolean;
  speed?: number;
  fadeFrames?: number;
}

/** Plays a clip on an actor from `atFrame`. Clips stay sorted by start and at least `fadeFrames` apart (the engine blends at most two at once). */
export function cueClip(c: Comp, sceneId: string, actorId: string, clip: { assetId?: string; name?: string }, atFrame: number, o: CueOptions = {}): Comp {
  const actor = actorOf(c, sceneId, actorId);
  if (!clip.assetId && !clip.name) throw new AuthoringError('bad_value', 'a clip needs an assetId (a motion clip asset) or a name (a clip inside the character model)');
  if (clip.assetId) assetOf(c, sceneId, clip.assetId, 'model');
  const end = sceneEnd(c, sceneId);
  const at = Math.round(atFrame);
  if (at < actor.inPoint || at >= end) throw new AuthoringError('time_out_of_range', `atFrame ${at} is outside the actor's time in the scene (${actor.inPoint} to ${end})`);
  const fade = o.fadeFrames ?? FADE_FRAMES;
  const out = raise(c, sceneId);
  if (clip.assetId) share(out, sceneId, clip.assetId);
  const a = actorOf(out, sceneId, actorId);
  const clips = ((a.clips as Obj[]) ?? []).filter((k) => k.startFrame !== at);
  const entry: Obj = { ...(clip.assetId ? { clipAssetId: clip.assetId } : {}), ...(clip.name ? { name: clip.name } : {}), startFrame: at, ...(o.loop ? { loop: true } : {}), ...(o.speed ? { speed: o.speed } : {}), fadeFrames: fade };
  clips.push(entry);
  clips.sort((x, y) => x.startFrame - y.startFrame);
  for (let i = 1; i < clips.length; i++) {
    if (clips[i]!.startFrame - clips[i - 1]!.startFrame < Math.max(1, fade)) throw new AuthoringError('keys_too_close', `clips at frames ${clips[i - 1]!.startFrame} and ${clips[i]!.startFrame} are closer than the ${fade}-frame cross-fade`, `Space clips at least ${fade} frames (${round(fade / 30)} s) apart`);
  }
  if (clips.length > LIMITS.clipsPerActor) throw new AuthoringError('bad_value', `an actor holds at most ${LIMITS.clipsPerActor} clips`);
  a.clips = clips;
  return out;
}

/** Walks an actor to a mark: it stays where it is until `atFrame`, then eases to `toMark` over `durationFrames`. */
export function moveActor(c: Comp, sceneId: string, actorId: string, toMark: Mark, atFrame: number, durationFrames: number): Comp {
  const actor = actorOf(c, sceneId, actorId);
  checkMark(toMark);
  const end = sceneEnd(c, sceneId);
  const at = Math.round(atFrame);
  const dur = Math.round(durationFrames);
  if (dur < 1) throw new AuthoringError('bad_value', 'durationFrames must be at least 1');
  if (at < actor.inPoint || at + dur > end) throw new AuthoringError('time_out_of_range', `the move (${at} to ${at + dur}) must fit inside the actor's time in the scene (${actor.inPoint} to ${end})`);
  const out = raise(c, sceneId);
  const a = actorOf(out, sceneId, actorId);
  const keys: Array<{ t: number; v: Mark; easeOut?: number[] }> = Array.isArray(a.marks) && a.marks.length && typeof a.marks[0] === 'object' ? a.marks : [{ t: a.inPoint, v: a.marks as Mark }];
  const before = keys.filter((k) => k.t < at);
  const here = before.length ? before[before.length - 1]!.v : keys[0]!.v;
  const next = [...before, { t: at, v: here, easeOut: [0.42, 0, 0.58, 1] }, { t: at + dur, v: [round(toMark[0]), round(toMark[1]), toMark[2]] as Mark }];
  a.marks = next.filter((k, i) => i === 0 || k.t > next[i - 1]!.t);
  return out;
}

export interface PlacePropOptions {
  assetId?: string;
  shape?: 'can' | 'bottle' | 'box' | 'jar' | 'tube' | 'pouch' | 'sphere';
  /** Height in metres. */
  size?: number;
  position?: [number, number, number];
  /** Hold it in a character's hand (the bone name inside the model, for example RightHand). */
  attach?: { actor: string; bone: string };
  product?: boolean;
  inFrame?: number;
}

/** Adds one prop3d (or the product when `product` is set; at most one per stage). A glTF asset or a primitive shape. */
export function placeProp(c: Comp, sceneId: string, propId: string, o: PlacePropOptions): Comp {
  needWorld(c, sceneId);
  if (!o.assetId === !o.shape) throw new AuthoringError('bad_value', 'give either assetId (a model) or shape, not both and not neither');
  if (o.assetId) assetOf(c, sceneId, o.assetId, 'model');
  const id = memberId(sceneId, propId);
  const exists = (precomp(c, sceneId).layers as Obj[]).some((l) => l.id === id);
  if (o.product) {
    const others = (precomp(c, sceneId).layers as Obj[]).filter((l) => l.kind === 'prop3d' && l.role === 'product' && l.id !== id).length;
    if (others >= LIMITS.products) throw new AuthoringError('bad_value', 'a stage holds one product');
  } else if (!exists && count(c, sceneId, 'prop3d', false) >= LIMITS.props) throw new AuthoringError('bad_value', `a stage holds at most ${LIMITS.props} props`);
  if (o.attach) actorOf(c, sceneId, o.attach.actor);
  const end = sceneEnd(c, sceneId);
  const out = raise(c, sceneId);
  if (o.assetId) share(out, sceneId, o.assetId);
  const layer: Obj = {
    id, name: propId, kind: 'prop3d', stage: worldId(sceneId), inPoint: Math.max(0, Math.round(o.inFrame ?? 0)), outPoint: end,
    ...(o.product ? { role: 'product' } : {}),
    source: o.assetId ? { type: 'gltf', assetId: o.assetId } : { type: 'primitive', shape: o.shape },
    // a model with no size is as big as the file says, which can be a room: default to a hand-sized toy
    size: Math.min(o.size ?? DEFAULT_PROP_SIZE, MAX_PROP_SIZE),
    position: o.position ?? [0, 0, 0],
    ...(o.attach ? { attach: { actor: memberId(sceneId, o.attach.actor), bone: o.attach.bone } } : {}),
  };
  replaceOrInsert(out, sceneId, layer, 'prop3d', o.assetId);
  return out;
}

/** The product on the stage: a prop3d with role 'product'. */
export const placeProduct3D = (c: Comp, sceneId: string, propId: string, o: Omit<PlacePropOptions, 'product'>): Comp => placeProp(c, sceneId, propId, { ...o, product: true });

const rise = (frames: number, peak: number) => [{ t: 0, v: 0 }, { t: Math.max(1, Math.min(frames, 30)), v: peak }];

/**
 * Light for the shot: dawn brings the key up from nothing and warms it, studio is even, spotlight dims the fill and rim and hits the middle, night is dark with a cool rim.
 * Each one is key/fill/rim keyframes on the world's `lights`.
 */
export function setLightCue(c: Comp, sceneId: string, cue: LightCue): Comp {
  needWorld(c, sceneId);
  const frames = sceneEnd(c, sceneId);
  const out = raise(c, sceneId);
  const w = needWorld(out, sceneId);
  const lights: Obj = {
    dawn: { preset: 'golden', key: { elevation: 12, intensity: rise(frames, 2.2), color: '#ffd9a8' }, fill: { intensity: 0.5 }, rim: { intensity: 0.8 } },
    studio: { preset: 'studio', key: { elevation: 30, intensity: 2.2 }, fill: { intensity: 0.6 }, rim: { intensity: 0.5 } },
    spotlight: { preset: 'studio', key: { elevation: 55, intensity: 3.2 }, fill: { intensity: 0.15 }, rim: { intensity: 0.3 } },
    night: { preset: 'night', key: { elevation: 20, intensity: 0.7, color: '#9bb7ff' }, fill: { intensity: 0.15 }, rim: { intensity: 1.1 } },
  }[cue]!;
  w.lights = { ...lights };
  return out;
}

/** Every stage in the film with what stands on it, for the critic and the showrunner. */
export function describeStage(c: Comp, sceneId: string): { actors: string[]; props: string[]; product?: string } {
  const layers = (precomp(c, sceneId).layers as Obj[]);
  const local = (id: string) => String(id).slice(sceneId.length + 1);
  const product = layers.find((l) => l.kind === 'prop3d' && l.role === 'product');
  return {
    actors: layers.filter((l) => l.kind === 'actor3d').map((l) => local(l.id)),
    props: layers.filter((l) => l.kind === 'prop3d' && l.role !== 'product').map((l) => local(l.id)),
    ...(product ? { product: local(product.id) } : {}),
  };
}
