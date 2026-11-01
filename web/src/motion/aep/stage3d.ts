// AEP stage3d (the cartoon world) -> MotionDoc three layer. See engine/docs/10-aep-adapter.md ("3D (A3)", stage3d).
// Camera, lighting preset, ground plane and flat backdrop plane. Members (actor3d / prop3d) are passed in so a
// later story can add their objects; they never become 2D layers. Actors become glTF objects here.
import type { AepLayer } from '@shared/aep/layer';
import type { AepAssetMap } from '@shared/aep/asset';
import type { AepAnimatable } from '@shared/aep/transform';
import type { Object3D, ThreeLayer } from '@engine/schema';
import { isKeyframed, propertyTweens, type ConvertedTween } from './keyframes';
import { mapBaseLayer } from './baseLayer';
import { sanitizeId } from './sanitizeId';
import { objectTweens } from './model3d';

type AepStage3DLayer = Extract<AepLayer, { kind: 'stage3d' }>;
type Vec3 = [number, number, number];

export interface StageContext {
  assets: AepAssetMap;
  fps: number;
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
  const tweens = objectTweens(actor.marks, ['position.x', 'position.z', 'rotation.y'], ctx.fps, actor.inPoint, target);

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

/** prop3d -> one object (glTF or primitive). `attach` has no bone support yet: place at the actor + [0.25, 0.9h, 0]. */
export function convertProp(
  prop: AepProp3DLayer,
  ctx: StageContext,
  actors: AepActor3DLayer[] = [],
): { object?: Object3D; tweens: ConvertedTween[]; warnings: string[] } {
  const warnings: string[] = [];
  const id = sanitizeId(prop.id);
  const target = `object:${id}`;
  const { source } = prop;

  if (source.type === 'card' || source.type === 'extrude') {
    warnings.push(`prop ${prop.id}: ${source.type} source is not supported yet; prop dropped`);
    return { tweens: [], warnings };
  }
  if (prop.material || prop.swarm || prop.billboard || prop.lit) {
    warnings.push(`prop ${prop.id}: material / swarm / billboard / lit are not supported yet`);
  }

  let geometry: Object3D['geometry'];
  let color = '#cccccc';
  if (source.type === 'gltf') {
    geometry = { type: 'gltf', asset: sanitizeId(source.assetId), height: prop.size } as Object3D['geometry'];
  } else {
    const w = source.proportions?.width ?? 1;
    const h = prop.size ?? source.proportions?.height ?? 1;
    if (source.shape === 'box') {
      geometry = { type: 'box', size: [w, h, source.proportions?.depth ?? w] };
    } else {
      if (source.shape !== 'can') warnings.push(`prop ${prop.id}: primitive '${source.shape}' drawn as a can`);
      geometry = { type: 'cylinder', radiusTop: w / 2, radiusBottom: w / 2, height: h };
    }
  }
  if (prop.textures?.side) color = prop.textures.side;

  let position: Vec3 = prop.position !== undefined ? (first(prop.position) as Vec3) : [0, 0, 0];
  let tweens = objectTweens(prop.position, ['position.x', 'position.y', 'position.z'], ctx.fps, prop.inPoint, target);
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
  const scaleValue = prop.scale !== undefined ? first(prop.scale) : 1;
  if (prop.scale !== undefined && isKeyframed(prop.scale)) warnings.push(`prop ${prop.id}: animated scale is not supported yet; using the first value`);
  tweens.push(...objectTweens(prop.rotation, ['rotation.x', 'rotation.y', 'rotation.z'], ctx.fps, prop.inPoint, target));

  const object = {
    id,
    geometry,
    position,
    rotation: prop.rotation !== undefined ? (first(prop.rotation) as Vec3) : [0, 0, 0],
    scale: scaleValue,
    material: { ...GLTF_MATERIAL, color: source.type === 'gltf' ? '#ffffff' : color },
    castShadow: prop.castShadow ?? true,
  } as unknown as Object3D;
  return { object, tweens, warnings };
}

export function convertWorld(world: AepStage3DLayer, members: AepLayer[], ctx: StageContext): ConvertWorldResult {
  const { base, tweens: baseTweens, warnings } = mapBaseLayer(world, ctx.fps);
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
  const lights = world.lights;
  if (lights && (lights.key || lights.fill || lights.rim || lights.ambient !== undefined || lights.spots?.length)) {
    warnings.push(`layer ${world.id}: lights key/fill/rim/ambient/spots overrides are not supported yet; using the preset`);
  }

  const style = world.style;
  if (style?.shading === 'toon' || style?.outline) {
    warnings.push(`layer ${world.id}: toon shading / outline is not supported yet; using standard shading`);
  }
  if (world.camera.focus) warnings.push(`layer ${world.id}: camera.focus is not supported yet`);
  if (world.set?.fog) warnings.push(`layer ${world.id}: set.fog is not supported yet`);

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

  if (world.camera.target && isKeyframed(world.camera.target)) {
    warnings.push(`layer ${world.id}: animated camera.target is not supported yet; using the first value`);
  }
  const fovValue = world.camera.fov ?? 35;
  const tweens = [
    ...baseTweens,
    ...actorTweens,
    ...cameraTweens(world.camera.position, ['position.x', 'position.y', 'position.z'], ctx.fps, world.inPoint),
    ...cameraTweens(fovValue, ['fov'], ctx.fps, world.inPoint),
  ].map((t) => ({ repeat: 0, yoyo: false, ...t }));
  if (tweens.length > 64) warnings.push(`layer ${world.id}: ${tweens.length} tweens exceed the engine limit of 64`);

  const shadowOpacity = world.shadow?.opacity !== undefined ? first(world.shadow.opacity) : 0.55;
  const layer = {
    ...base,
    id,
    anchor: [0.5, 0.5] as [number, number],
    effects: [],
    tweens: tweens.slice(0, 64),
    type: 'three' as const,
    width: clampSize(width),
    height: clampSize(height),
    background: 'transparent' as const,
    camera: {
      position: first(world.camera.position) as Vec3,
      lookAt: first(world.camera.target) as Vec3,
      fov: first(fovValue),
      near: 0.1,
      far: 200,
    },
    lighting: { preset: lightingPreset, environment: lights?.environment },
    lights: [],
    shadow: { enabled: shadowOpacity > 0, opacity: shadowOpacity, y: 0 },
    objects,
  } as unknown as ThreeLayer;

  return { layer, warnings };
}
