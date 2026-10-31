import * as THREE from 'three';
import { type MotionDoc } from '../../schema/doc';
import { type Animation3D, type Light3D, type ThreeLayer } from '../../schema/layer3d';
import { disposeObject3D } from './dispose';
import { loadGltf, type LoadedGltf } from './gltf';
import { applyEnvironment, createLightingRig, disposeLightingRig, resolveLightingConfig } from './lighting';
import { loadTexture } from './materials';
import { buildObject, type BuiltObject, type ObjectBuildContext } from './object';
import { createShadowCatcher, fitShadowCamera } from './shadow';

// A `three` layer turned into a ready scene: camera, lights (preset rig + extras), the objects
// (each a wrapper Group) and the shadow catcher. ThreeNode only has to draw it and scrub time.

export interface SceneContext extends ObjectBuildContext {
  /** The shared renderer, used to build the room environment map. Omitted in unit tests (no WebGL). */
  renderer?: THREE.WebGLRenderer;
}

export interface RigMixer {
  mixer: THREE.AnimationMixer;
  clip: THREE.AnimationClip;
  animation: Animation3D;
}

export interface ThreeRig {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** Camera target the tweens move; `update` calls `camera.lookAt(lookAt)`. */
  lookAt: THREE.Vector3;
  objects: Map<string, THREE.Object3D>;
  lights: Map<string, THREE.Light>;
  shadow: THREE.Mesh | null;
  mixers: RigMixer[];
  warnings: string[];
  dispose: () => void;
}

const SHADOW_SIZE_MARGIN = 2.6;
const DEFAULT_SHADOW_SIZE = 20;

export function buildScene(layer: ThreeLayer, ctx: SceneContext = {}): ThreeRig {
  const warnings: string[] = [];
  const scene = new THREE.Scene();
  if (layer.background !== 'transparent') scene.background = new THREE.Color(layer.background);

  const camera = new THREE.PerspectiveCamera(
    layer.camera.fov,
    layer.width / layer.height,
    layer.camera.near,
    layer.camera.far,
  );
  camera.position.set(layer.camera.position[0], layer.camera.position[1], layer.camera.position[2]);
  const lookAt = new THREE.Vector3(layer.camera.lookAt[0], layer.camera.lookAt[1], layer.camera.lookAt[2]);
  camera.lookAt(lookAt);

  const lightingConfig = resolveLightingConfig(layer.lighting.preset, {}, layer.lighting.environment);
  const lighting = createLightingRig(lightingConfig);
  scene.add(lighting.group);
  if (ctx.renderer) applyEnvironment(scene, lightingConfig, ctx.renderer);

  const lights = new Map<string, THREE.Light>();
  if (layer.lighting.preset !== 'none') {
    lights.set('key', lighting.key);
    lights.set('fill', lighting.fill);
    lights.set('rim', lighting.rim);
    lights.set('ambient', lighting.ambient);
  }
  for (const spec of layer.lights) {
    const { light, target } = buildLight(spec);
    scene.add(light);
    if (target) scene.add(target);
    lights.set(spec.id, light);
  }

  const objects = new Map<string, THREE.Object3D>();
  const mixers: RigMixer[] = [];
  const built: BuiltObject[] = [];
  const gltfAssets = new Set<string>();
  for (const spec of layer.objects) {
    const object = buildObject(spec, ctx);
    warnings.push(...object.warnings);
    scene.add(object.root);
    objects.set(spec.id, object.root);
    if (object.mixer && object.clip && spec.animation) {
      mixers.push({ mixer: object.mixer, clip: object.clip, animation: spec.animation });
    }
    if (spec.geometry.type === 'gltf') gltfAssets.add(spec.geometry.asset);
    built.push(object);
  }

  const box = new THREE.Box3();
  for (const object of built) box.union(new THREE.Box3().setFromObject(object.root));

  let shadow: THREE.Mesh | null = null;
  if (layer.shadow.enabled) {
    const size = box.isEmpty()
      ? DEFAULT_SHADOW_SIZE
      : Math.max(box.max.x - box.min.x, box.max.z - box.min.z, 1e-3) * SHADOW_SIZE_MARGIN;
    const center = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
    shadow = createShadowCatcher({ opacity: layer.shadow.opacity, y: layer.shadow.y, size });
    shadow.position.set(center.x, layer.shadow.y, center.z);
    scene.add(shadow);
    if (layer.lighting.preset !== 'none') fitShadowCamera(lighting.key, box);
  }

  const dispose = () => {
    for (const object of built) object.dispose();
    disposeLightingRig(lighting);
    if (shadow) {
      shadow.geometry.dispose();
      (shadow.material as THREE.Material).dispose();
    }
    // Clones share geometry/material/texture with the loaded glTF, so free the source once here.
    for (const assetId of gltfAssets) {
      const loaded = ctx.gltfs?.get(assetId);
      if (loaded) disposeObject3D(loaded.scene);
    }
    // Textures are loaded once per layer and shared across its objects, so they are freed here too.
    ctx.textures?.forEach((texture) => texture.dispose());
    scene.clear();
  };

  return { scene, camera, lookAt, objects, lights, shadow, mixers, warnings, dispose };
}

function buildLight(spec: Light3D): { light: THREE.Light; target: THREE.Object3D | null } {
  const color = new THREE.Color(spec.color);
  switch (spec.type) {
    case 'ambient':
      return { light: new THREE.AmbientLight(color, spec.intensity), target: null };
    case 'point': {
      const light = new THREE.PointLight(color, spec.intensity);
      light.position.set(spec.position[0], spec.position[1], spec.position[2]);
      light.castShadow = spec.castShadow;
      return { light, target: null };
    }
    case 'directional': {
      const light = new THREE.DirectionalLight(color, spec.intensity);
      light.position.set(spec.position[0], spec.position[1], spec.position[2]);
      light.castShadow = spec.castShadow;
      // A directional/spot light aims at its target object, which must be in the scene graph.
      light.target.position.set(spec.target[0], spec.target[1], spec.target[2]);
      return { light, target: light.target };
    }
    case 'spot': {
      const light = new THREE.SpotLight(color, spec.intensity);
      light.position.set(spec.position[0], spec.position[1], spec.position[2]);
      light.castShadow = spec.castShadow;
      light.target.position.set(spec.target[0], spec.target[1], spec.target[2]);
      return { light, target: light.target };
    }
  }
}

export interface PreloadedThreeAssets {
  textures: Map<string, THREE.Texture>;
  gltfs: Map<string, LoadedGltf>;
  errors: Array<{ assetId: string; error: unknown }>;
}

/** Load every image and glTF asset a layer references, in parallel; one failure never stops the rest. */
export async function preloadThreeAssets(layer: ThreeLayer, doc: MotionDoc): Promise<PreloadedThreeAssets> {
  const textureIds = new Set<string>();
  const gltfIds = new Set<string>();
  for (const object of layer.objects) {
    if (object.material.map !== undefined) textureIds.add(object.material.map);
    if (object.geometry.type === 'gltf') gltfIds.add(object.geometry.asset);
  }

  const textures = new Map<string, THREE.Texture>();
  const gltfs = new Map<string, LoadedGltf>();
  const errors: Array<{ assetId: string; error: unknown }> = [];

  await Promise.all([
    ...[...textureIds].map(async (assetId) => {
      try {
        const texture = await loadTexture(doc.assets[assetId].url);
        // Loaded once per layer and shared by every object that uses it, so disposal skips it here.
        texture.userData.shared = true;
        textures.set(assetId, texture);
      } catch (error) {
        errors.push({ assetId, error });
      }
    }),
    ...[...gltfIds].map(async (assetId) => {
      try {
        gltfs.set(assetId, await loadGltf(doc.assets[assetId].url));
      } catch (error) {
        errors.push({ assetId, error });
      }
    }),
  ]);

  return { textures, gltfs, errors };
}
