import { Sprite, Texture } from 'pixi.js';
import type * as THREE from 'three';
import { pathRef, type PropKind, type TargetRef } from '../core/paths';
import { applyBaseTransform, resolveBaseTarget } from '../core/transform';
import type { MotionNode, NodeContext, NodeFactory } from '../core/types';
import type { ThreeLayer } from '../schema/layer3d';
import { disposeObject3D } from './build/dispose';
import { clipTime } from './build/gltf';
import { buildScene, preloadThreeAssets, type PreloadedThreeAssets, type ThreeRig } from './build/scene';
import {
  acquireOffscreenRenderer,
  releaseOffscreenRenderer,
  type ThreeOffscreenRenderer,
} from './offscreen';

// A `three` layer as a MotionNode: the rig (camera, lights, objects, shadow) is drawn by the shared
// offscreen renderer into a 2D canvas, which is the node's Pixi texture/sprite. Tweens move the Three
// objects directly through `resolveTarget`; `update(t)` only scrubs glTF mixers, applies `lookAt`/fov
// and draws, so a seek renders the frame the tweens describe.

/** The slice of the m6 post-processing chain ThreeNode talks to. m4 always leaves it null. */
export interface ThreePostFx {
  draw(renderer: THREE.WebGLRenderer): void;
  resolveTarget(id: string, prop: string): TargetRef | null;
}

export interface ThreeNode extends MotionNode {
  /** Load problems that did not stop the layer (missing glTF asset, clip fallback). */
  readonly warnings: string[];
  /** Distinct render errors, reported once each; the layer keeps playing. */
  readonly errors: string[];
  /** Set by m6; null until a post-processing chain exists. */
  postFx: ThreePostFx | null;
}

// A layer whose rig cannot be built without loading (a glTF or a textured material) needs an async
// pass; a primitive-only layer builds its rig synchronously, so its targets resolve immediately.
function needsAsyncAssets(layer: ThreeLayer): boolean {
  return layer.objects.some((object) => object.geometry.type === 'gltf' || object.material.map !== undefined);
}

/** `pathRef` throws for a missing segment; a tween target never wants that, so a bad path is null. */
function tryPathRef(root: object, path: string, kind: PropKind): TargetRef | null {
  try {
    return pathRef(root, path, kind);
  } catch {
    return null;
  }
}

/** A colour target writes a hex string back to the real Three colour. */
function colorTarget(color: THREE.Color): TargetRef {
  return {
    obj: color,
    key: 'color',
    kind: 'color',
    getColor: () => `#${color.getHexString()}`,
    setColor: (hex) => color.set(hex),
  };
}

// `scale` on an object writes all three axes (engine/docs/02-timeline.md, "Target paths"), so it goes
// through a proxy whose setter scales uniformly and whose getter reads the x axis.
const uniformScaleProxies = new WeakMap<THREE.Object3D, { scale: number }>();

function uniformScaleProxy(root: THREE.Object3D): { scale: number } {
  let proxy = uniformScaleProxies.get(root);
  if (!proxy) {
    proxy = {
      get scale(): number {
        return root.scale.x;
      },
      set scale(value: number) {
        root.scale.setScalar(value);
      },
    };
    uniformScaleProxies.set(root, proxy);
  }
  return proxy;
}

/** The first standard material under an object wrapper (a primitive's mesh, or a glTF's first mesh). */
function firstMaterial(root: THREE.Object3D): THREE.MeshStandardMaterial | null {
  let found: THREE.MeshStandardMaterial | null = null;
  root.traverse((child) => {
    if (found) return;
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    if (material && (material as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
      found = material as THREE.MeshStandardMaterial;
    }
  });
  return found;
}

function resolveCameraTarget(rig: ThreeRig, prop: string): TargetRef | null {
  switch (prop) {
    case 'position.x':
      return tryPathRef(rig.camera.position, 'x', 'number');
    case 'position.y':
      return tryPathRef(rig.camera.position, 'y', 'number');
    case 'position.z':
      return tryPathRef(rig.camera.position, 'z', 'number');
    case 'lookAt.x':
      return tryPathRef(rig.lookAt, 'x', 'number');
    case 'lookAt.y':
      return tryPathRef(rig.lookAt, 'y', 'number');
    case 'lookAt.z':
      return tryPathRef(rig.lookAt, 'z', 'number');
    // Three's PerspectiveCamera.fov is already in degrees, so no degree -> radian conversion.
    case 'fov':
      return { obj: rig.camera, key: 'fov', kind: 'number' };
    default:
      return null;
  }
}

function resolveMaterialTarget(wrapper: THREE.Object3D, prop: string): TargetRef | null {
  if (!prop.startsWith('material.')) return null;
  const material = firstMaterial(wrapper);
  if (!material) return null;
  switch (prop) {
    case 'material.color':
      return colorTarget(material.color);
    case 'material.emissive':
      return colorTarget(material.emissive);
    case 'material.emissiveIntensity':
      return { obj: material, key: 'emissiveIntensity', kind: 'number' };
    case 'material.roughness':
      return { obj: material, key: 'roughness', kind: 'number' };
    case 'material.metalness':
      return { obj: material, key: 'metalness', kind: 'number' };
    case 'material.opacity':
      return { obj: material, key: 'opacity', kind: 'number' };
    default:
      return null;
  }
}

function resolveObjectTarget(wrapper: THREE.Object3D, prop: string): TargetRef | null {
  switch (prop) {
    // Rotations are authored in degrees and Three stores radians (engine/docs/04-three.md).
    case 'rotation.x':
      return tryPathRef(wrapper.rotation, 'x', 'deg');
    case 'rotation.y':
      return tryPathRef(wrapper.rotation, 'y', 'deg');
    case 'rotation.z':
      return tryPathRef(wrapper.rotation, 'z', 'deg');
    case 'position.x':
      return tryPathRef(wrapper.position, 'x', 'number');
    case 'position.y':
      return tryPathRef(wrapper.position, 'y', 'number');
    case 'position.z':
      return tryPathRef(wrapper.position, 'z', 'number');
    case 'scale':
      return { obj: uniformScaleProxy(wrapper), key: 'scale', kind: 'number' };
    case 'scale.x':
      return tryPathRef(wrapper.scale, 'x', 'number');
    case 'scale.y':
      return tryPathRef(wrapper.scale, 'y', 'number');
    case 'scale.z':
      return tryPathRef(wrapper.scale, 'z', 'number');
    default:
      return resolveMaterialTarget(wrapper, prop);
  }
}

function resolveLightTarget(light: THREE.Light, prop: string): TargetRef | null {
  switch (prop) {
    case 'intensity':
      return { obj: light, key: 'intensity', kind: 'number' };
    case 'color':
      return colorTarget(light.color);
    case 'position.x':
      return tryPathRef(light.position, 'x', 'number');
    case 'position.y':
      return tryPathRef(light.position, 'y', 'number');
    case 'position.z':
      return tryPathRef(light.position, 'z', 'number');
    default:
      return null;
  }
}

export const createThreeNode: NodeFactory = (layer, ctx, parentStart) => {
  if (layer.type !== 'three') {
    throw new Error(`motion: createThreeNode expects a three layer, got ${layer.type}`);
  }
  return buildThreeNode(layer, ctx, parentStart);
};

function buildThreeNode(layer: ThreeLayer, ctx: NodeContext, parentStart: number): ThreeNode {
  const { width, height } = layer;
  const start = parentStart + layer.start;
  const end = parentStart + (layer.end ?? layer.start);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const texture = Texture.from(canvas);
  const sprite = new Sprite(texture);
  applyBaseTransform(sprite, layer, { width, height });

  const warnings: string[] = [];
  const errors: string[] = [];

  let shared: ThreeOffscreenRenderer | null = null;
  let acquired = false;
  let rig: ThreeRig | null = null;
  let destroyed = false;
  let readySettled = false;
  let drawn = false;
  let lastError = '';
  let lastFov = layer.camera.fov;

  let resolveReady: () => void = () => {};
  let rejectReady: (error: unknown) => void = () => {};
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  // Attach a handler so an unattached rejection (WebGL unavailable) never surfaces as unhandled.
  ready.catch(() => {});

  try {
    shared = acquireOffscreenRenderer(ctx.app);
    acquired = true;
  } catch (error) {
    // No WebGL (or the context could not be created): the display stays an empty sprite and the doc
    // keeps playing (engine/docs/04-three.md, "ThreeNode").
    readySettled = true;
    rejectReady(error);
  }

  const buildRig = (assets?: PreloadedThreeAssets): void => {
    if (assets) {
      for (const failure of assets.errors) {
        warnings.push(`three asset ${failure.assetId}: ${String(failure.error)}`);
      }
    }
    const built = buildScene(layer, {
      textures: assets?.textures,
      gltfs: assets?.gltfs,
      renderer: shared?.renderer,
    });
    warnings.push(...built.warnings);
    rig = built;
  };

  if (shared) {
    if (needsAsyncAssets(layer)) {
      preloadThreeAssets(layer, ctx.doc)
        .then((assets) => {
          if (destroyed) {
            for (const loaded of assets.textures.values()) loaded.dispose();
            for (const gltf of assets.gltfs.values()) disposeObject3D(gltf.scene);
            return;
          }
          buildRig(assets);
        })
        .catch((error) => {
          if (destroyed || readySettled) return;
          readySettled = true;
          rejectReady(error);
        });
    } else {
      buildRig();
    }
  }

  const node: ThreeNode = {
    id: layer.id,
    layer,
    display: sprite,
    start,
    end,
    children: [],
    postFx: null,
    warnings,
    errors,

    size: () => ({ width, height }),

    resolveTarget(target, prop) {
      if (target === undefined) return resolveBaseTarget(sprite, prop);
      if (target === 'camera') return rig ? resolveCameraTarget(rig, prop) : null;

      const objectPrefix = 'object:';
      if (target.startsWith(objectPrefix)) {
        const wrapper = rig?.objects.get(target.slice(objectPrefix.length));
        return wrapper ? resolveObjectTarget(wrapper, prop) : null;
      }

      const lightPrefix = 'light:';
      if (target.startsWith(lightPrefix)) {
        const light = rig?.lights.get(target.slice(lightPrefix.length));
        return light ? resolveLightTarget(light, prop) : null;
      }

      const postFxPrefix = 'postfx:';
      if (target.startsWith(postFxPrefix)) {
        return node.postFx?.resolveTarget(target.slice(postFxPrefix.length), prop) ?? null;
      }

      // `filter:<id>` and anything else are the runtime's job (2D filters run on every node).
      return null;
    },

    update(timeSec) {
      if (destroyed || !rig || !shared) return;

      const localSec = timeSec - start;
      for (const entry of rig.mixers) {
        entry.mixer.setTime(clipTime(localSec, entry.clip.duration, entry.animation));
      }

      rig.camera.lookAt(rig.lookAt);
      if (rig.camera.fov !== lastFov) {
        lastFov = rig.camera.fov;
        rig.camera.updateProjectionMatrix();
      }

      const postFx = node.postFx;
      try {
        shared.render({
          canvas,
          scene: rig.scene,
          camera: rig.camera,
          width,
          height,
          draw: postFx ? (renderer) => postFx.draw(renderer) : undefined,
        });
        texture.source.update();
        if (!drawn) {
          drawn = true;
          if (!readySettled) {
            readySettled = true;
            resolveReady();
          }
        }
      } catch (error) {
        const message = String(error);
        if (lastError !== message) {
          lastError = message;
          errors.push(message);
        }
      }
    },

    ready,

    destroy() {
      if (destroyed) return;
      destroyed = true;
      rig?.dispose();
      rig = null;
      texture.destroy(true);
      sprite.destroy();
      if (acquired) releaseOffscreenRenderer(ctx.app);
    },
  };

  return node;
}
