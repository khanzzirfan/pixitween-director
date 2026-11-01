// AEP model3d layer -> MotionDoc three layer. See engine/docs/10-aep-adapter.md ("3D (A3)", model3d).
// One object (primitive can/box or a glTF), the layer's view.rotation/position/scale become tweens on
// `object:<id>`, and the camera distance is chosen so object height x camera.fit fills the viewport height.
import type { AepLayer } from '@shared/aep/layer';
import type { AepAnimatable, AepKeyframe } from '@shared/aep/transform';
import type { AepRotationUnit } from '@shared/aep/rotation';
import type { Object3D, ThreeLayer } from '@engine/schema';
import { isKeyframed, propertyTweens, type ConvertedTween } from './keyframes';
import { mapBaseLayer } from './baseLayer';
import { sanitizeId } from './sanitizeId';

type AepModel3DLayer = Extract<AepLayer, { kind: 'model3d' }>;
type Vec3 = [number, number, number];

export interface ConvertModel3DResult {
  /** `undefined` when the source cannot be represented (extrude); a warning says why. */
  layer?: ThreeLayer;
  warnings: string[];
}

const MIN_SIZE = 16;
const MAX_SIZE = 2048;
const DEFAULT_FOV = 30;
const DEFAULT_FIT = 1.5;

function first<T>(value: AepAnimatable<T>): T {
  return isKeyframed(value) ? value[0].v : value;
}

/** Camera distance so an object of `height` times `fit` fills the viewport height at `fov` degrees. */
export function cameraDistance(height: number, fit: number, fovDeg: number): number {
  return (height * fit) / (2 * Math.tan((fovDeg * Math.PI) / 360));
}

function mapKeyframes<T, U>(value: AepKeyframe<T>[], fn: (v: T) => U): AepKeyframe<U>[] {
  return value.map((k) => ({ ...k, v: fn(k.v) }));
}

/** Tweens for a vector/scalar property; axes whose from === to in a tween are dropped (and the tween if none move). */
export function objectTweens(
  value: AepAnimatable<number | number[]> | undefined,
  props: string[],
  fps: number,
  inPoint: number,
  target: string,
): ConvertedTween[] {
  if (value === undefined || !isKeyframed(value)) return [];
  const out: ConvertedTween[] = [];
  for (const t of propertyTweens(value, { fps, inPoint, props }).tweens) {
    const moving = props.filter((p) => t.from[p] !== t.to[p]);
    if (moving.length === 0) continue;
    const pick = (m: Record<string, number>): Record<string, number> => Object.fromEntries(moving.map((p) => [p, m[p]]));
    out.push({ ...t, from: pick(t.from), to: pick(t.to), ...{ target } });
  }
  return out;
}

export function convertModel3D(layer: AepModel3DLayer, fps: number, rotationUnit?: AepRotationUnit): ConvertModel3DResult {
  const { base, tweens: baseTweens, warnings } = mapBaseLayer(layer, fps, rotationUnit);
  const id = sanitizeId(layer.id);
  const { source } = layer;

  if (source.type === 'extrude') {
    warnings.push(`layer ${layer.id}: model3d extrude source is not supported yet; layer dropped`);
    return { warnings };
  }

  // viewport -> layer size, clamped to the engine limits (16..2048).
  let { width, height: vh } = layer.viewport;
  const clamped = Math.min(1, MAX_SIZE / Math.max(width, vh));
  if (clamped < 1 || Math.min(width, vh) < MIN_SIZE) {
    warnings.push(`layer ${layer.id}: viewport ${width}x${vh} outside engine limits; clamped`);
    width = Math.round(width * clamped);
    vh = Math.round(vh * clamped);
  }
  width = Math.min(MAX_SIZE, Math.max(MIN_SIZE, width));
  vh = Math.min(MAX_SIZE, Math.max(MIN_SIZE, vh));

  const mat = layer.material;
  const material: Object3D['material'] = {
    color: layer.textures?.side ?? '#cccccc',
    roughness: mat?.roughness !== undefined ? first(mat.roughness) : 0.4,
    metalness: mat?.metalness !== undefined ? first(mat.metalness) : 0,
    emissive: '#000000',
    emissiveIntensity: 0,
    opacity: 1,
    map: layer.textures?.label ? sanitizeId(layer.textures.label) : undefined,
  };
  if (mat?.clearcoat !== undefined) material.clearcoat = first(mat.clearcoat);
  if (mat?.style === 'toon' || mat?.outline) warnings.push(`layer ${layer.id}: toon style / outline is not supported yet`);
  if (layer.textures?.front) warnings.push(`layer ${layer.id}: textures.front is not supported yet`);

  let geometry: Object3D['geometry'];
  let objectHeight: number;
  let animation: Object3D['animation'];
  if (source.type === 'primitive') {
    const w = source.proportions?.width ?? 1;
    objectHeight = source.proportions?.height ?? 1;
    if (source.shape === 'box') {
      geometry = { type: 'box', size: [w, objectHeight, source.proportions?.depth ?? w] };
    } else {
      if (source.shape !== 'can') warnings.push(`layer ${layer.id}: primitive '${source.shape}' drawn as a can`);
      geometry = { type: 'cylinder', radiusTop: w / 2, radiusBottom: w / 2, height: objectHeight };
    }
  } else {
    objectHeight = layer.bounds?.size[1] ?? 1;
    geometry = { type: 'gltf', asset: sanitizeId(source.assetId), height: layer.bounds?.size[1] };
    const a = source.animation;
    if (a) {
      if (typeof a.clip === 'number') warnings.push(`layer ${layer.id}: animation clip index ${a.clip} needs a clip name; playing the first clip`);
      animation = {
        clip: typeof a.clip === 'string' ? a.clip : undefined,
        speed: a.speed ?? 1,
        loop: a.loop ?? true,
        offset: a.offset ?? 0,
      };
    }
  }

  const target = `object:${id}`;
  const view = layer.view;
  const rotation: Vec3 = view?.rotation !== undefined ? (first(view.rotation) as Vec3) : [0, 0, 0];
  const position: Vec3 = view?.position !== undefined ? (first(view.position) as Vec3) : [0, 0, 0];
  const scale = view?.scale !== undefined ? first(view.scale) : 1;

  const viewTweens: ConvertedTween[] = [
    ...objectTweens(view?.rotation, ['rotation.x', 'rotation.y', 'rotation.z'], fps, layer.inPoint, target),
    ...objectTweens(view?.position, ['position.x', 'position.y', 'position.z'], fps, layer.inPoint, target),
    ...objectTweens(view?.scale, ['scale'], fps, layer.inPoint, target),
  ];

  // Camera: fov kept; distance re-fits per fov keyframe (dolly zoom).
  const fovValue = layer.camera?.fov ?? DEFAULT_FOV;
  const fit = layer.camera?.fit ?? DEFAULT_FIT;
  const fov0 = first(fovValue);
  const cameraTweens: ConvertedTween[] = [];
  if (isKeyframed(fovValue)) {
    for (const t of propertyTweens(fovValue, { fps, inPoint: layer.inPoint, props: ['fov'] }).tweens) {
      cameraTweens.push({ ...t, ...{ target: 'camera' } });
    }
    const zs = mapKeyframes(fovValue, (v) => cameraDistance(objectHeight, fit, v));
    for (const t of propertyTweens(zs, { fps, inPoint: layer.inPoint, props: ['position.z'] }).tweens) {
      cameraTweens.push({ ...t, ...{ target: 'camera' } });
    }
  }

  const { lighting } = layer;
  // Key, fill and rim overrides ride on the engine's `lighting` fields; keyframed ones also become `lighting` tweens.
  const lightingFields: Record<string, number | string | undefined> = {};
  const lightingTweens: ConvertedTween[] = [];
  const addLight = (prop: string, value: ReturnType<typeof first> | undefined, raw: unknown) => {
    if (raw === undefined) return;
    lightingFields[prop] = value as number;
    if (isKeyframed(raw as never)) {
      for (const t of propertyTweens(raw as never, { fps, inPoint: layer.inPoint, props: [prop] }).tweens) {
        lightingTweens.push({ ...t, ...{ target: 'lighting' } });
      }
    }
  };
  addLight('keyAzimuth', lighting?.key?.azimuth !== undefined ? first(lighting.key.azimuth) : undefined, lighting?.key?.azimuth);
  addLight('keyElevation', lighting?.key?.elevation !== undefined ? first(lighting.key.elevation) : undefined, lighting?.key?.elevation);
  addLight('keyIntensity', lighting?.key?.intensity !== undefined ? first(lighting.key.intensity) : undefined, lighting?.key?.intensity);
  addLight('fillIntensity', lighting?.fill?.intensity !== undefined ? first(lighting.fill.intensity) : undefined, lighting?.fill?.intensity);
  addLight('rimIntensity', lighting?.rim?.intensity !== undefined ? first(lighting.rim.intensity) : undefined, lighting?.rim?.intensity);
  if (lighting?.key?.color !== undefined) lightingFields.keyColor = lighting.key.color as string;

  const shadowOpacity = layer.shadow ? first(layer.shadow.opacity) : 0;

  const engineTweens = [...baseTweens, ...viewTweens, ...cameraTweens, ...lightingTweens].map((t) => ({ repeat: 0, yoyo: false, ...t }));
  if (engineTweens.length > 64) warnings.push(`layer ${layer.id}: ${engineTweens.length} tweens exceed the engine limit of 64`);

  const three = {
    ...base,
    id,
    anchor: [0.5, 0.5] as [number, number],
    effects: [],
    tweens: engineTweens.slice(0, 64),
    type: 'three' as const,
    width,
    height: vh,
    background: 'transparent' as const,
    camera: {
      position: [0, 0, cameraDistance(objectHeight, fit, fov0)] as Vec3,
      lookAt: [0, 0, 0] as Vec3,
      fov: fov0,
      near: 0.1,
      far: 200,
    },
    lighting: {
      preset: lighting?.preset ?? 'studio',
      environment: lighting?.environment,
      ...lightingFields,
    },
    lights: [],
    shadow: {
      enabled: shadowOpacity > 0,
      opacity: shadowOpacity,
      y: -objectHeight / 2 + (layer.shadow?.offsetY ?? 0),
      softness: layer.shadow?.softness,
    },
    objects: [
      {
        id,
        geometry,
        position,
        rotation,
        scale,
        material,
        castShadow: true,
        animation,
      },
    ],
  } as unknown as ThreeLayer;

  return { layer: three, warnings };
}
