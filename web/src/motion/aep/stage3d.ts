// AEP stage3d (the cartoon world) -> MotionDoc three layer. See engine/docs/10-aep-adapter.md ("3D (A3)", stage3d).
// Camera, lighting preset, ground plane and flat backdrop plane. Members (actor3d / prop3d) are passed in so a
// later story can add their objects; they never become 2D layers. Actors become glTF objects here.
import type { AepLayer } from '@shared/aep/layer';
import type { AepAssetMap } from '@shared/aep/asset';
import type { AepAnimatable } from '@shared/aep/transform';
import type { AepRotationUnit } from '@shared/aep/rotation';
import { THREE_TWEENS_MAX, type Object3D, type ThreeLayer } from '@engine/schema';
import { isKeyframed, propertyTweens, type ConvertedTween } from './keyframes';
import { mapBaseLayer } from './baseLayer';
import { sanitizeId } from './sanitizeId';
import { objectTweens } from './model3d';

type AepStage3DLayer = Extract<AepLayer, { kind: 'stage3d' }>;
type Vec3 = [number, number, number];

export interface StageContext {
  assets: AepAssetMap;
  fps: number;
  /** The world's in-point (frames): members' keyframes are composition frames, tweened on the world's clock. */
  worldInPoint?: number;
  /** The world's out-point (frames): a member that lives to it stays on the world's last frame. */
  worldOutPoint?: number;
  /** The unit the composition's layer rotations are written in ('rad' for a legacy film). */
  rotationUnit?: AepRotationUnit;
}

export interface ConvertWorldResult {
  layer: ThreeLayer;
  warnings: string[];
}

const PRESETS = ['studio', 'window', 'golden', 'night'] as const;
const MIN_SIZE = 16;
const MAX_SIZE = 2048;
const DEFAULT_GROUND = '#d9cbb8';
const DEFAULT_GROUND_SIZE: [number, number] = [10, 8];
const DEFAULT_WALL = { distance: 3, height: 5 };

function first<T>(value: AepAnimatable<T>): T {
  return isKeyframed(value) ? value[0].v : value;
}

function clampSize(n: number): number {
  return Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.round(n)));
}

function cameraTweens(
  value: AepAnimatable<number | number[]> | undefined,
  props: string[],
  fps: number,
  inPoint: number,
): ConvertedTween[] {
  if (value === undefined || !isKeyframed(value)) return [];
  return propertyTweens(value, { fps, inPoint, props }).tweens.map((t) => ({ ...t, ...{ target: 'camera' } }));
}

type AepActor3DLayer = Extract<AepLayer, { kind: 'actor3d' }>;

const GLTF_MATERIAL = {
  color: '#ffffff',
  roughness: 0.8,
  metalness: 0,
  emissive: '#000000',
  emissiveIntensity: 0,
  opacity: 1,
};

/** actor3d -> one glTF object standing on its marks ([x, z, facingDeg] -> position x/z + rotation.y). */
export function convertActor(
  actor: AepActor3DLayer,
  ctx: StageContext,
): { object: Object3D; tweens: ConvertedTween[]; warnings: string[] } {
  const warnings: string[] = [];
  const id = sanitizeId(actor.id);
  const target = `object:${id}`;

  const [x, z, facing] = first(actor.marks) as Vec3;
  const tweens = objectTweens(actor.marks, ['position.x', 'position.z', 'rotation.y'], ctx.fps, ctx.worldInPoint ?? 0, target);

  const clips = actor.clips ?? [];
  const [clip, ...dropped] = clips;
  let animation: Object3D['animation'];
  if (clip) {
    if (clip.name === undefined) {
      warnings.push(`actor ${actor.id}: clip by clipAssetId '${String(clip.clipAssetId)}' is not supported yet; no clip played`);
    } else {
      animation = { clip: clip.name, speed: clip.speed ?? 1, loop: clip.loop ?? true, offset: clip.offset ?? 0 };
    }
    if (clip.startFrame > 0) warnings.push(`actor ${actor.id}: first clip startFrame ${clip.startFrame} ignored; playing from the actor's inPoint`);
  }
  if (dropped.length > 0) {
    const names = dropped.map((c) => c.name ?? c.clipAssetId ?? '?').join(', ');
    warnings.push(`actor ${actor.id}: only one animation clip is supported yet; dropped clip ${names}`);
  }
  if (actor.rootMotion === 'keep') warnings.push(`actor ${actor.id}: rootMotion 'keep' is not supported yet`);

  const object = {
    id,
    geometry: { type: 'gltf', asset: sanitizeId(actor.assetId), height: actor.height },
    position: [x, 0, z],
    rotation: [0, facing, 0],
    scale: 1,
    material: GLTF_MATERIAL,
    castShadow: actor.castShadow ?? true,
    animation,
  } as unknown as Object3D;
  return { object, tweens, warnings };
}

type AepProp3DLayer = Extract<AepLayer, { kind: 'prop3d' }>;
const MAX_OBJECTS = 50;

// Defaults of the reacthub-pixitweenjs stage3d prop these films were made on.
const PROP_DEFAULT_SIZE = 0.4;
const PROP_ROUGHNESS = 0.35;
const PROP_METALNESS = 0.05;
const PROP_SIDE = '#d8d8d8';

/**
 * prop3d -> one object, built like the library's stage prop: sized so its largest side is `size` and
 * standing on its base (`fit`), a turned body for packaging primitives, an extruded contour, or an image
 * card (unlit, facing the camera, flipbook frames); a swarm is the same object as instanced copies.
 * `attach` has no bone support yet: place at the actor + [0.25, 0.9h, 0].
 */
export function convertProp(
  prop: AepProp3DLayer,
  ctx: StageContext,
  actors: AepActor3DLayer[] = [],
): { object?: Object3D; tweens: ConvertedTween[]; warnings: string[] } {
  const warnings: string[] = [];
  const id = sanitizeId(prop.id);
  const target = `object:${id}`;
  const clock = ctx.worldInPoint ?? 0;
  const { source } = prop;
  const mat = prop.material;
  const side = prop.textures?.side ?? PROP_SIDE;
  const sizeOf = (assetId: string | undefined): { w: number; h: number } | undefined => {
    const asset = assetId ? ctx.assets[assetId] : undefined;
    return asset && 'width' in asset && 'height' in asset && typeof asset.width === 'number' && typeof asset.height === 'number'
      ? { w: asset.width, h: asset.height }
      : undefined;
  };

  let geometry: Object3D['geometry'];
  let color = side;
  let map: string | undefined;
  let unlit = false;
  let transparent = false;
  let flipbook: Object3D['flipbook'];
  const isCard = source.type === 'card';
  if (source.type === 'gltf') {
    geometry = { type: 'gltf', asset: sanitizeId(source.assetId) } as Object3D['geometry'];
    color = '#ffffff';
  } else if (source.type === 'card') {
    const frames = source.frames?.length ? source.frames : prop.textures?.front ? [prop.textures.front] : [];
    if (frames.length === 0) {
      warnings.push(`prop ${prop.id}: card needs textures.front or source.frames; prop dropped`);
      return { tweens: [], warnings };
    }
    const dims = sizeOf(frames[0]);
    geometry = { type: 'plane', size: [dims ? dims.w / dims.h : 1, 1] };
    map = sanitizeId(frames[0]);
    unlit = prop.lit !== true;
    transparent = true;
    color = '#ffffff';
    if (frames.length > 1) flipbook = { frames: frames.map(sanitizeId), fps: source.fps ?? 12, loop: source.loop ?? false };
  } else if (source.type === 'smoke') {
    // Vapour faces the camera and changes every frame: never fitted, timed to the prop's life, tinted by its colour.
    geometry = {
      type: 'smoke',
      form: source.form,
      size: prop.size ?? PROP_DEFAULT_SIZE,
      duration: Math.max(0.2, (prop.outPoint - prop.inPoint) / ctx.fps),
      ...(source.seed !== undefined ? { seed: source.seed } : {}),
    };
    color = mat?.color ?? '#f2ece4';
  } else if (source.type === 'liquid') {
    // A liquid is never fitted (it changes shape every frame): `size` is the edge of its box, timed to the prop's life.
    geometry = {
      type: 'liquid',
      form: source.form,
      size: prop.size ?? PROP_DEFAULT_SIZE,
      duration: Math.max(0.2, (prop.outPoint - prop.inPoint) / ctx.fps),
      ...(source.seed !== undefined ? { seed: source.seed } : {}),
    };
    color = mat?.color ?? '#3b2314';
  } else if (source.type === 'extrude') {
    // The depth is read once, at the prop's in-point.
    const depth = sampleAt(source.depth, prop.inPoint, 100);
    geometry = { type: 'extrude', contour: source.contour, depth: Math.max(depth, 1e-6), bevel: source.bevel, sideColor: side, ...(source.section !== undefined ? { section: source.section } : {}), ...(source.axis !== undefined ? { axis: source.axis } : {}) };
    if (prop.textures?.front) map = sanitizeId(prop.textures.front);
  } else if (source.shape === 'box') {
    const w = source.proportions?.width ?? 1;
    const h = source.proportions?.height ?? 1;
    geometry = { type: 'box', size: [w, h, source.proportions?.depth ?? w], ...(source.round ? { round: source.round } : {}) };
    if (prop.textures?.front || prop.textures?.label) warnings.push(`prop ${prop.id}: a box's front image is not supported yet; drawn in its side colour`);
  } else {
    geometry = { type: 'lathe', shape: source.shape, width: source.proportions?.width ?? 1, height: source.proportions?.height ?? 1 };
    const label = prop.textures?.label ?? prop.textures?.front;
    if (label) map = sanitizeId(label);
  }
  // `material.color` tints only a surface without an image.
  if (mat?.color && !map) color = mat.color;

  let position: Vec3 = prop.position !== undefined ? (first(prop.position) as Vec3) : [0, 0, 0];
  let tweens = objectTweens(prop.position, ['position.x', 'position.y', 'position.z'], ctx.fps, clock, target);
  if (prop.attach) {
    const { actor: actorId, bone } = prop.attach;
    warnings.push(`prop ${prop.id}: attach to bone '${bone}' of actor ${actorId} is not supported yet; placed near the actor`);
    const owner = actors.find((a) => a.id === actorId);
    if (owner) {
      const [ax, az] = first(owner.marks) as Vec3;
      position = [ax + 0.25, 0.9 * (owner.height ?? 1), az];
    }
    tweens = [];
  }
  const billboard = isCard && (prop.billboard ?? true);
  // A billboard takes its turn from the camera; only its roll (z) is authored.
  if (!billboard) tweens.push(...objectTweens(prop.rotation, ['rotation.x', 'rotation.y', 'rotation.z'], ctx.fps, clock, target));
  else if (prop.rotation !== undefined && isKeyframed(prop.rotation)) warnings.push(`prop ${prop.id}: an animated card roll is not supported yet; using the first value`);
  tweens.push(...objectTweens(prop.scale, ['scale.x', 'scale.y', 'scale.z'], ctx.fps, clock, target));
  if (!unlit) {
    tweens.push(...objectTweens(mat?.roughness, ['material.roughness'], ctx.fps, clock, target));
    tweens.push(...objectTweens(mat?.metalness, ['material.metalness'], ctx.fps, clock, target));
  }

  let swarm: Object3D['swarm'];
  if (prop.swarm) {
    swarm = { ...prop.swarm, fps: ctx.fps, duration: Math.max(0, (prop.outPoint - prop.inPoint) / 30) } as Object3D['swarm'];
  }

  const object = {
    id,
    geometry,
    position,
    rotation: prop.rotation !== undefined ? (first(prop.rotation) as Vec3) : [0, 0, 0],
    scale: prop.scale !== undefined ? (first(prop.scale) as Vec3) : 1,
    material: {
      color,
      roughness: mat?.roughness !== undefined ? first(mat.roughness) : PROP_ROUGHNESS,
      metalness: mat?.metalness !== undefined ? first(mat.metalness) : PROP_METALNESS,
      emissive: '#000000',
      emissiveIntensity: 0,
      opacity: mat?.opacity ?? 1,
      map,
      unlit,
      transparent,
      // The library's props are always physical (clearcoat 0 by default).
      clearcoat: unlit ? undefined : (mat?.clearcoat ?? 0),
      condensation: mat?.condensation,
      transmission: mat?.transmission,
      ior: mat?.ior,
      thickness: mat?.thickness,
    },
    castShadow: prop.castShadow ?? (!isCard && source.type !== 'smoke'),
    fit: source.type === 'liquid' || source.type === 'smoke' ? undefined : (prop.size ?? PROP_DEFAULT_SIZE),
    life: propLife(prop, clock, ctx),
    billboard: billboard || undefined,
    flipbook,
    swarm,
  } as unknown as Object3D;
  return { object, tweens, warnings };
}

/** A scalar animatable's value at composition frame `frame` (hold keys and out-handle easing as the library sampled them). */
function sampleAt(value: AepAnimatable<number> | undefined, frame: number, fallback: number): number {
  if (value === undefined) return fallback;
  if (!isKeyframed(value)) return value;
  const keys = value;
  if (frame <= keys[0].t) return keys[0].v;
  const last = keys[keys.length - 1];
  if (frame >= last.t) return last.v;
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (frame < a.t || frame > b.t) continue;
    if (a.hold) return a.v;
    const raw = b.t > a.t ? (frame - a.t) / (b.t - a.t) : 0;
    return a.v + (b.v - a.v) * (a.easeOut ? cubicBezierAt(a.easeOut, raw) : raw);
  }
  return last.v;
}

function cubicBezierAt([x1, y1, x2, y2]: readonly number[], x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  let t = x;
  for (let i = 0; i < 8; i++) {
    const u = 1 - t;
    const xt = 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t;
    const dxt = 3 * u * u * x1 + 6 * u * t * (x2 - x1) + 3 * t * t * (1 - x2);
    if (Math.abs(dxt) < 1e-9) break;
    t = Math.min(1, Math.max(0, t - (xt - x) / dxt));
  }
  const u = 1 - t;
  return 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t;
}

/**
 * One tween for every set of tweens that start together, last as long, ease alike and drive the same target: the camera's position and lens
 * keyed on the same frames move as one tween, not two. A layer may hold only 64 tweens, and this is what lets a film of ten shots keep both.
 * The order of the first of each set is kept.
 */
export function mergeTweens<T extends ConvertedTween & { target?: string; repeat?: number; yoyo?: boolean }>(tweens: T[]): T[] {
  const out: T[] = [];
  const at = new Map<string, T>();
  for (const t of tweens) {
    const id = [t.target ?? '', t.at, t.duration, t.ease, t.repeat ?? 0, t.yoyo ?? false].join('|');
    const hit = at.get(id);
    if (hit && !Object.keys(t.to).some((k) => k in hit.to)) {
      Object.assign(hit.from, t.from);
      Object.assign(hit.to, t.to);
      continue;
    }
    const copy = { ...t, from: { ...t.from }, to: { ...t.to } };
    at.set(id, copy);
    out.push(copy);
  }
  return out;
}

/**
 * A member's life on the world's clock, in seconds. The engine shows an object while its time is before `end`, as a 2D layer's out-point;
 * a 2D layer that ends with the film still shows on the film's last frame, so a member that lives to the world's end gets one frame more,
 * or it would vanish on the last frame.
 */
export function propLife(prop: { inPoint: number; outPoint: number }, clock: number, ctx: StageContext): { start: number; end: number } {
  const toEnd = ctx.worldOutPoint !== undefined && prop.outPoint >= ctx.worldOutPoint;
  return { start: Math.max(0, (prop.inPoint - clock) / ctx.fps), end: Math.max(0, (prop.outPoint + (toEnd ? 1 : 0) - clock) / ctx.fps) };
}

export function convertWorld(world: AepStage3DLayer, members: AepLayer[], outerCtx: StageContext): ConvertWorldResult {
  const ctx: StageContext = { ...outerCtx, worldInPoint: world.inPoint, worldOutPoint: world.outPoint };
  const { base, tweens: baseTweens, warnings } = mapBaseLayer(world, ctx.fps, ctx.rotationUnit);
  const id = sanitizeId(world.id);

  let { width, height } = world.viewport;
  if (Math.max(width, height) > MAX_SIZE || Math.min(width, height) < MIN_SIZE) {
    warnings.push(`layer ${world.id}: viewport ${width}x${height} outside engine limits; clamped`);
    const k = Math.min(1, MAX_SIZE / Math.max(width, height));
    width *= k;
    height *= k;
  }

  const preset = world.lights?.preset;
  let lightingPreset: (typeof PRESETS)[number] = 'studio';
  if (preset !== undefined) {
    if ((PRESETS as readonly string[]).includes(preset)) lightingPreset = preset;
    else warnings.push(`layer ${world.id}: unknown lighting preset '${String(preset)}'; using 'studio'`);
  }
  // The key (aim, level, colour), fill, rim and ambient follow their keyframes, as the library's world
  // sampled them every frame.
  const lights = world.lights;
  const lighting: Record<string, unknown> = {};
  const lightTweens: ConvertedTween[] = [];
  const lightValue = (value: AepAnimatable<number> | undefined, prop: 'keyAzimuth' | 'keyElevation' | 'keyIntensity' | 'fillIntensity' | 'rimIntensity' | 'ambient') => {
    if (value === undefined) return;
    lighting[prop] = first(value);
    lightTweens.push(...propertyTweens(value, { fps: ctx.fps, inPoint: world.inPoint, props: [prop] }).tweens.map((t) => ({ ...t, ...{ target: 'lighting' } })));
  };
  lightValue(lights?.key?.azimuth, 'keyAzimuth');
  lightValue(lights?.key?.elevation, 'keyElevation');
  lightValue(lights?.key?.intensity, 'keyIntensity');
  lightValue(lights?.fill?.intensity, 'fillIntensity');
  lightValue(lights?.rim?.intensity, 'rimIntensity');
  lightValue(lights?.ambient, 'ambient');
  if (lights?.key?.color) lighting.keyColor = lights.key.color;
  if (lights?.rim?.color) lighting.rimColor = lights.rim.color;
  // Spot lights become the engine's own lights (key, fill, rim and ambient are the preset's); their aim, level and cone follow their keyframes.
  const spots = (lights?.spots ?? []).map((s) => {
    const own = (value: AepAnimatable<number | number[]>, props: string[]) =>
      propertyTweens(value, { fps: ctx.fps, inPoint: world.inPoint, props }).tweens.map((t) => ({ ...t, ...{ target: `light:${s.id}` } }));
    if (isKeyframed(s.intensity)) lightTweens.push(...own(s.intensity, ['intensity']));
    if (isKeyframed(s.position)) lightTweens.push(...own(s.position, ['position.x', 'position.y', 'position.z']));
    if (isKeyframed(s.target)) lightTweens.push(...own(s.target, ['target.x', 'target.y', 'target.z']));
    if (s.angle !== undefined && isKeyframed(s.angle)) lightTweens.push(...own(s.angle, ['angle']));
    return {
      id: s.id,
      type: 'spot' as const,
      intensity: first(s.intensity),
      position: first(s.position) as Vec3,
      target: first(s.target) as Vec3,
      castShadow: s.castShadow ?? false,
      ...(s.color ? { color: s.color } : {}),
      ...(s.angle !== undefined ? { angle: first(s.angle) } : {}),
      ...(s.penumbra !== undefined ? { penumbra: s.penumbra } : {}),
    };
  });

  const style = world.style;
  if (style?.shading === 'toon' || style?.outline) {
    warnings.push(`layer ${world.id}: toon shading / outline is not supported yet; using standard shading`);
  }
  if (world.set?.fog) warnings.push(`layer ${world.id}: set.fog is not supported yet`);

  // Depth of field: the library's circle-of-confusion pass, focus distance keyframed on the world.
  const effects: Array<{ id: string; type: string; params: Record<string, number | string> }> = [];
  // Shader transitions at the cuts: composition frames become seconds on the world's own clock.
  const shotTransitions = (world.shotTransitions ?? []).map((t) => ({
    at: Math.max(0, (t.startFrame - world.inPoint) / ctx.fps),
    duration: Math.max(0.05, t.durationFrames / ctx.fps),
    name: t.name,
    ...(t.params ? { params: t.params } : {}),
  }));
  const focusTweens: ConvertedTween[] = [];
  const focus = world.camera.focus;
  if (focus && (isKeyframed(focus.aperture) || (first(focus.aperture) ?? 0) > 0)) {
    effects.push({ id: 'dof', type: 'stageDof', params: { aperture: first(focus.aperture), focusDistance: first(focus.distance), ...(focus.bokeh ? { bokeh: focus.bokeh } : {}) } });
    focusTweens.push(
      ...propertyTweens(focus.distance, { fps: ctx.fps, inPoint: world.inPoint, props: ['focusDistance'] }).tweens.map((t) => ({ ...t, ...{ target: 'effect:dof' } })),
    );
    if (isKeyframed(focus.aperture)) {
      focusTweens.push(...propertyTweens(focus.aperture, { fps: ctx.fps, inPoint: world.inPoint, props: ['aperture'] }).tweens.map((t) => ({ ...t, ...{ target: 'effect:dof' } })));
    }
  }

  // The finish: bloom, vignette, grain, fringe and grade over the rendered world, after the depth of field. Bloom's intensity can swell.
  const post = world.post;
  if (post?.bloom) {
    effects.push({ id: 'bloom', type: 'bloom', params: { intensity: first(post.bloom.intensity), threshold: post.bloom.threshold ?? 0.6, radius: post.bloom.radius ?? 0.7 } });
    if (isKeyframed(post.bloom.intensity)) {
      focusTweens.push(...propertyTweens(post.bloom.intensity, { fps: ctx.fps, inPoint: world.inPoint, props: ['intensity'] }).tweens.map((t) => ({ ...t, ...{ target: 'effect:bloom' } })));
    }
  }
  if (post?.halation) effects.push({ id: 'halation', type: 'bloom', params: { intensity: Math.round(post.halation * 90) / 100, threshold: 0.3, radius: 0.95 } });
  if (post?.streak) effects.push({ id: 'streak', type: 'lensStreak', params: { strength: post.streak.strength, ...(post.streak.color ? { color: post.streak.color } : {}), ...(post.streak.threshold !== undefined ? { threshold: post.streak.threshold } : {}), ...(post.streak.reach !== undefined ? { reach: post.streak.reach } : {}) } });
  if (post?.grade) {
    const g = post.grade;
    if (g.brightness !== undefined || g.contrast !== undefined) effects.push({ id: 'grade', type: 'brightnessContrast', params: { brightness: g.brightness ?? 0, contrast: g.contrast ?? 0 } });
    if (g.hue !== undefined || g.saturation !== undefined) effects.push({ id: 'tone', type: 'hueSaturation', params: { hue: g.hue ?? 0, saturation: g.saturation ?? 0 } });
  }
  if (post?.splitTone) effects.push({ id: 'split', type: 'splitTone', params: { shadows: post.splitTone.shadows, highlights: post.splitTone.highlights, ...(post.splitTone.amount !== undefined ? { amount: post.splitTone.amount } : {}), ...(post.splitTone.balance !== undefined ? { balance: post.splitTone.balance } : {}) } });
  if (post?.aberration) effects.push({ id: 'fringe', type: 'chromaticAberration', params: { offsetX: post.aberration.offset, offsetY: post.aberration.offset } });
  if (post?.vignette) effects.push({ id: 'vignette', type: 'vignette', params: { offset: post.vignette.offset ?? 0.3, darkness: post.vignette.darkness } });
  if (post?.grain) effects.push({ id: 'grain', type: 'noise', params: { opacity: post.grain.opacity } });

  const timeWarp = (world.timeWarp ?? []).map((w) => ({ from: Math.max(0, (w.startFrame - world.inPoint) / ctx.fps), to: Math.max(0.01, (w.startFrame + w.durationFrames - world.inPoint) / ctx.fps), rates: w.rates }));
  const motionBlur = post?.motionBlur?.shots.length
    ? {
        samples: post.motionBlur.samples ?? 6,
        spans: post.motionBlur.shots.map((s) => ({ from: Math.max(0, (s.startFrame - world.inPoint) / ctx.fps), to: Math.max(0.01, (s.startFrame + s.durationFrames - world.inPoint) / ctx.fps), shutter: s.shutter })),
      }
    : undefined;

  const objects: Object3D[] = [];
  const set = world.set;

  const ground = set?.ground ?? DEFAULT_GROUND;
  if (ground !== 'none') {
    objects.push({
      id: 'ground',
      geometry: { type: 'plane', size: set?.groundSize ?? DEFAULT_GROUND_SIZE },
      position: [0, 0, 0],
      rotation: [-90, 0, 0],
      scale: 1,
      material: { color: ground, roughness: 0.9, metalness: 0, emissive: '#000000', emissiveIntensity: 0, opacity: 1 },
      castShadow: false,
    } as Object3D);
  }

  if (set?.reflection && ground !== 'none') {
    // A glossy floor over the ground, a hair above it: the world reflected, soft, fading away from the product.
    const size = set.groundSize ?? DEFAULT_GROUND_SIZE;
    objects.push({
      id: 'mirror',
      geometry: { type: 'mirror', size, strength: set.reflection.strength, fade: set.reflection.fade ?? 0.35, ...(set.reflection.blur !== undefined ? { blur: set.reflection.blur } : {}) },
      position: [0, 0.0008, 0],
      rotation: [-90, 0, 0],
      scale: 1,
      material: { color: '#ffffff', roughness: 1, metalness: 0, emissive: '#000000', emissiveIntensity: 0, opacity: 1 },
      castShadow: false,
    } as Object3D);
  }

  if (set?.caustics && ground !== 'none') {
    // Light rippling on the floor round the product, added over the ground (and its reflection), a hair above both.
    objects.push({
      id: 'caustics',
      geometry: { type: 'caustics', size: set.groundSize ?? DEFAULT_GROUND_SIZE, strength: set.caustics.strength, fade: set.caustics.fade ?? 0.3, scale: set.caustics.scale ?? 40 },
      position: [0, 0.0012, 0],
      rotation: [-90, 0, 0],
      scale: 1,
      material: { color: set.caustics.color ?? '#f4fbff', roughness: 1, metalness: 0, emissive: '#000000', emissiveIntensity: 0, opacity: 1 },
      castShadow: false,
    } as Object3D);
  }

  if (set?.backdrop) {
    if (set.wall === false) {
      warnings.push(`layer ${world.id}: set.backdrop ignored because set.wall is false`);
    } else {
      const wall = { ...DEFAULT_WALL, ...(set.wall ?? {}) };
      if (wall.curve !== undefined && wall.curve > 0) {
        warnings.push(`layer ${world.id}: set.wall.curve is not supported yet; backdrop drawn flat`);
      }
      const asset = ctx.assets[set.backdrop];
      const w = asset && 'width' in asset && typeof asset.width === 'number' ? asset.width : undefined;
      const h = asset && 'height' in asset && typeof asset.height === 'number' ? asset.height : undefined;
      const aspect = w && h ? w / h : 16 / 9;
      objects.push({
        id: 'backdrop',
        geometry: { type: 'plane', size: [wall.height * aspect, wall.height] },
        position: [0, wall.height / 2, -wall.distance],
        rotation: [0, 0, 0],
        scale: 1,
        material: {
          color: '#ffffff',
          roughness: 1,
          metalness: 0,
          emissive: '#000000',
          emissiveIntensity: 0,
          opacity: 1,
          map: sanitizeId(set.backdrop),
        },
        castShadow: false,
      } as Object3D);
    }
  }

  if (objects.length === 0) {
    // ThreeLayer needs >= 1 object; keep a tiny invisible plane so a bare world still loads.
    objects.push({
      id: 'ground',
      geometry: { type: 'plane', size: [1, 1] },
      position: [0, 0, 0],
      rotation: [-90, 0, 0],
      scale: 1,
      material: { color: DEFAULT_GROUND, roughness: 1, metalness: 0, emissive: '#000000', emissiveIntensity: 0, opacity: 0 },
      castShadow: false,
    } as Object3D);
  }

  const actorTweens: ConvertedTween[] = [];
  const actorLayers = members.filter((m): m is AepActor3DLayer => m.kind === 'actor3d');
  let dropped = 0;
  const addObject = (o: Object3D): boolean => {
    if (objects.length >= MAX_OBJECTS) {
      dropped++;
      return false;
    }
    objects.push(o);
    return true;
  };
  for (const m of members) {
    if (m.hidden) continue;
    if (m.kind === 'actor3d') {
      const a = convertActor(m, ctx);
      if (addObject(a.object)) actorTweens.push(...a.tweens);
      warnings.push(...a.warnings);
    } else if (m.kind === 'prop3d') {
      const p = convertProp(m, ctx, actorLayers);
      warnings.push(...p.warnings);
      if (p.object && addObject(p.object)) actorTweens.push(...p.tweens);
    }
  }
  if (dropped > 0) warnings.push(`layer ${world.id}: ${dropped} object(s) dropped; the engine allows at most ${MAX_OBJECTS} objects per scene`);

  const fovValue = world.camera.fov ?? 35;
  const tweens = mergeTweens(
    [
      ...baseTweens,
      ...actorTweens,
      ...cameraTweens(world.camera.position, ['position.x', 'position.y', 'position.z'], ctx.fps, world.inPoint),
      ...cameraTweens(world.camera.target, ['lookAt.x', 'lookAt.y', 'lookAt.z'], ctx.fps, world.inPoint),
      ...cameraTweens(fovValue, ['fov'], ctx.fps, world.inPoint),
      ...lightTweens,
      ...focusTweens,
    ].map((t) => ({ repeat: 0, yoyo: false, ...t })),
  );
  if (tweens.length > THREE_TWEENS_MAX) warnings.push(`layer ${world.id}: ${tweens.length} tweens exceed the engine limit of ${THREE_TWEENS_MAX}`);

  // The library's floor: a shadow-only catcher at 0.55 under `ground: "none"`, darkened by the key
  // light's shadow strength (the world's shadow opacity), over the whole ground size.
  const shadowOpacity = world.shadow?.opacity !== undefined ? first(world.shadow.opacity) : 0.55;
  if (world.shadow?.opacity !== undefined && isKeyframed(world.shadow.opacity)) warnings.push(`layer ${world.id}: animated shadow opacity is not supported yet; using the first value`);
  const catcherOpacity = ground === 'none' ? 0.55 * shadowOpacity : shadowOpacity;
  const layer = {
    ...base,
    id,
    anchor: [0.5, 0.5] as [number, number],
    tweens: tweens.slice(0, THREE_TWEENS_MAX),
    type: 'three' as const,
    width: clampSize(width),
    height: clampSize(height),
    background: 'transparent' as const,
    effects,
    ...(shotTransitions.length ? { transitions: shotTransitions } : {}),
    ...(motionBlur ? { motionBlur } : {}),
    ...(timeWarp.length ? { timeWarp } : {}),
    camera: {
      position: first(world.camera.position) as Vec3,
      lookAt: first(world.camera.target) as Vec3,
      fov: first(fovValue),
      near: 0.05,
      far: 200,
    },
    lighting: { preset: lightingPreset, environment: lights?.environment, ...lighting },
    lights: spots,
    shadow: {
      enabled: shadowOpacity > 0,
      opacity: catcherOpacity,
      y: 0,
      softness: world.shadow?.softness ?? 0.5,
      size: set?.groundSize ?? DEFAULT_GROUND_SIZE,
    },
    exposure: world.style?.exposure ?? 1,
    objects,
  } as unknown as ThreeLayer;

  return { layer, warnings };
}
