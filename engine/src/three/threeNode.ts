import * as THREE from 'three';
import { pathRef, type PropKind, type TargetRef } from '../core/paths';
import { createLayerMaterial } from '../core/layerMaterial';
import { applyBaseTransform, createLayerObjects, resolveBaseTarget } from '../core/transform';
import type { MotionNode, NodeContext, NodeFactory } from '../core/types';
import { buildEffectChain, type EffectChain } from '../effects/chain';
import { EFFECTS, type ParamValue } from '../effects/table';
import type { ThreeLayer } from '../schema/layer3d';
import type { ShotSpec } from '../schema/shot';
import { frameShot as frameShotBySpec } from './camera/frameShot';
import { samplePath } from './camera/path';
import { TransitionRenderer, loadGlTransitions, usable, type GlTransitionLib } from './transition';
import { applyRig, ZERO_RIG_OFFSETS, type RigOffsets } from './camera/rig';
import { resolveUnitTargets } from './text/targets';
import { parseUnitTarget } from '../schema/scalars';
import { disposeObject3D } from './build/dispose';
import { clipTime } from './build/gltf';
import { warpClock } from '../core/speedRamp';
import { buildScene, LIGHTING_TWEEN_PROPS, preloadThreeAssets, type PreloadedThreeAssets, type ThreeRig } from './build/scene';

// A `three` layer as a MotionNode (engine/docs/04-three.md): the rig renders through its effect chain
// (ACES last) into a WebGLRenderTarget on the player's one renderer, shown on a plane in the stage.
// Tweens move the Three objects directly through `resolveTarget`; `update(t)` scrubs glTF mixers,
// applies `lookAt`/fov and renders, so a seek draws the frame the tweens describe.

export interface ThreeNode extends MotionNode {
  /** Distinct render errors, reported once each; the layer keeps playing. */
  readonly errors: string[];
  /** The rig once built (null while assets load), for labs and tests. */
  readonly rig: ThreeRig | null;
}

// A layer whose rig cannot be built without loading (a glTF or a textured material) needs an async
// pass; a primitive-only layer builds its rig synchronously, so its targets resolve immediately.
function needsAsyncAssets(layer: ThreeLayer): boolean {
  return layer.objects.some((object) => object.geometry.type === 'gltf' || object.geometry.type === 'text3d' || object.material.map !== undefined || object.flipbook !== undefined);
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

/**
 * The camera's tweenable properties.
 *
 * The position and the look-at point are the camera's *rest* pose, not the camera itself: the rig
 * offsets are applied on top of the rest pose on every update, so a tween that wrote the camera
 * would bake the offsets in and they would never come off again.
 */
function resolveCameraTarget(rig: ThreeRig, offsets: RigOffsets, prop: string): TargetRef | null {
  switch (prop) {
    case 'position.x':
      return tryPathRef(rig.restPosition, 'x', 'number');
    case 'position.y':
      return tryPathRef(rig.restPosition, 'y', 'number');
    case 'position.z':
      return tryPathRef(rig.restPosition, 'z', 'number');
    case 'lookAt.x':
      return tryPathRef(rig.lookAt, 'x', 'number');
    case 'lookAt.y':
      return tryPathRef(rig.lookAt, 'y', 'number');
    case 'lookAt.z':
      return tryPathRef(rig.lookAt, 'z', 'number');
    // Three's PerspectiveCamera.fov is already in degrees, so no degree -> radian conversion.
    case 'fov':
      return { obj: rig.camera, key: 'fov', kind: 'number' };
    // The rig moves are film words: degrees for the turns, metres for the travels. They stay in
    // the units the author wrote them in, so the rig maths does the conversion.
    case 'rig.pan':
      return { obj: offsets, key: 'pan', kind: 'number' };
    case 'rig.tilt':
      return { obj: offsets, key: 'tilt', kind: 'number' };
    case 'rig.roll':
      return { obj: offsets, key: 'roll', kind: 'number' };
    case 'rig.dolly':
      return { obj: offsets, key: 'dolly', kind: 'number' };
    case 'rig.truck':
      return { obj: offsets, key: 'truck', kind: 'number' };
    case 'rig.pedestal':
      return { obj: offsets, key: 'pedestal', kind: 'number' };
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

/**
 * The world box of a shot's subject: `"object:<id>"` or `"objects:<id>,<id>"` (several subjects
 * are framed as one box). Null when the subject names nothing this layer has to frame.
 */
function subjectBox(rig: ThreeRig, subject: string): THREE.Box3 | null {
  const separator = subject.indexOf(':');
  if (separator < 0) return null;
  const kind = subject.slice(0, separator);
  if (kind !== 'object' && kind !== 'objects') return null;

  const box = new THREE.Box3();
  let found = false;
  for (const id of subject.slice(separator + 1).split(',')) {
    const object = rig.objects.get(id.trim());
    if (!object) continue;
    box.union(new THREE.Box3().setFromObject(object));
    found = true;
  }
  // An object with no geometry (a glTF whose asset failed to load) leaves the box empty, and an
  // empty box has no centre to frame.
  return found && !box.isEmpty() ? box : null;
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
  const renderer = ctx.renderer;

  const { display, content } = createLayerObjects(layer);
  applyBaseTransform(display, content, layer, { width, height });

  // Linear half-float colour: the chain writes linear values and the stage converts to sRGB on output.
  const target = new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType, depthBuffer: true });
  const planeGeometry = new THREE.PlaneGeometry(width, height);
  // The rig's render target holds premultiplied colour, so the plane's own texture is read as such.
  const plane = createLayerMaterial({
    blendMode: layer.blendMode,
    color: '#ffffff',
    map: target.texture,
    premultiplied: true,
  });
  const planeMaterial = plane.material;
  // The rig's output is already multiplied by alpha, and its tone mapping and colour encoding ran on that
  // premultiplied colour (as the reacthub-pixitweenjs offscreen renderer's did, which is what gives
  // glass and soft edges their look). It is added over what is behind it as it is, not multiplied
  // by alpha a second time; the other blend modes keep their own factors.
  if (!layer.blendMode || layer.blendMode === 'normal') {
    planeMaterial.blending = THREE.CustomBlending;
    planeMaterial.blendEquation = THREE.AddEquation;
    planeMaterial.blendSrc = THREE.OneFactor;
    planeMaterial.blendDst = THREE.OneMinusSrcAlphaFactor;
    planeMaterial.blendSrcAlpha = THREE.OneFactor;
    planeMaterial.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
  }
  const planeMesh = new THREE.Mesh(planeGeometry, planeMaterial);
  planeMesh.name = `${layer.id}:plane`;
  planeMesh.position.set(width / 2, -height / 2, 0);
  content.add(planeMesh);

  const warnings: string[] = [];
  const errors: string[] = [];
  const alpha = { value: layer.alpha };
  // The rig moves, in the units the author wrote them in: degrees for the turns, metres for the
  // travels. They are absolute offsets from the camera's rest pose, so a tween writes the value it
  // means and the camera is recomputed from the rest pose on every update.
  const rigOffsets: RigOffsets = { ...ZERO_RIG_OFFSETS };

  let rig: ThreeRig | null = null;
  let chain: EffectChain | null = null;
  let destroyed = false;
  let readySettled = false;
  let lastError = '';
  let lastFov = layer.camera.fov;
  // A path owns the lens only when it says something about it; otherwise the layer's lens stands.
  const pathOwnsFov = layer.camera.path?.keys.some((key) => key.fov !== undefined) ?? false;

  // Shader transitions: the gl-transitions list loads on first use; the renderer holds the old shot's picture and the mix.
  const transitions = layer.transitions ?? [];
  let glLib: GlTransitionLib | null = null;
  let mixer: TransitionRenderer | null = null;
  const glLoad: Promise<void> | null = transitions.length
    ? loadGlTransitions().then((lib) => {
        glLib = lib;
      }, () => {})
    : null;

  let resolveReady: () => void = () => {};
  let rejectReady: (error: unknown) => void = () => {};
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  ready.catch(() => {});

  const settleReady = (): void => {
    if (readySettled) return;
    readySettled = true;
    resolveReady();
  };

  const reportError = (error: unknown): void => {
    const message = String(error);
    if (lastError === message) return;
    lastError = message;
    errors.push(message);
  };

  // `chain` is only built once this layer's (possibly async) assets resolve, but tweens are compiled
  // against the node right away. Returning null here until then would compile the tween onto nothing,
  // which is permanent (compileTweens resolves once, up front) — so each requested effect param gets a
  // stable object whose accessors re-check the live `chain` on every GSAP tick, not just at this call.
  const lazyEffectProxies = new Map<string, Record<string, ParamValue>>();

  const lightingProxy = {} as Record<string, number>;
  for (const prop of LIGHTING_TWEEN_PROPS) {
    Object.defineProperty(lightingProxy, prop, {
      enumerable: true,
      get: () => rig?.lightingTarget[prop] ?? 0,
      set: (value: number) => {
        if (rig) rig.lightingTarget[prop] = value;
      },
    });
  }

  // The layer's exposure scales the scene before the ACES curve (three's tone mapping exposure, which
  // the chain's tone mapping reads); the shared renderer gets its own value back afterwards.
  const renderChain = (built: EffectChain, r: THREE.WebGLRenderer | null): void => {
    if (!r) {
      built.render(r as unknown as THREE.WebGLRenderer);
      return;
    }
    const previous = r.toneMappingExposure;
    r.toneMappingExposure = layer.exposure;
    // A transparent layer draws over a clear alpha of 0, as the library's offscreen renderer always did:
    // three's glass (transmission) pass reads the renderer's clear alpha, and a transparent one makes it
    // see a pale backdrop instead of the stage's own clear colour.
    const clearColor = r.getClearColor(new THREE.Color());
    const clearAlpha = r.getClearAlpha();
    if (layer.background === 'transparent') r.setClearColor(0x000000, 0);
    try {
      built.render(r);
    } finally {
      r.toneMappingExposure = previous;
      r.setClearColor(clearColor, clearAlpha);
    }
  };

  function resolveEffectTarget(id: string, prop: string): TargetRef | null {
    const spec = layer.effects.find((e) => e.id === id);
    const tw = spec ? EFFECTS[spec.type]?.tweenable[prop] : undefined;
    if (!tw) return null;
    if (tw.kind === 'color') {
      return {
        obj: {},
        key: prop,
        kind: 'color',
        getColor: () => chain?.resolveTarget(id, prop)?.getColor?.() ?? '#000000',
        setColor: (hex) => chain?.resolveTarget(id, prop)?.setColor?.(hex),
      };
    }
    let proxy = lazyEffectProxies.get(id);
    if (!proxy) {
      proxy = {};
      lazyEffectProxies.set(id, proxy);
    }
    if (!(prop in proxy)) {
      Object.defineProperty(proxy, prop, {
        enumerable: true,
        configurable: true,
        get: () => {
          const live = chain?.resolveTarget(id, prop);
          return live ? (live.obj as Record<string, ParamValue>)[live.key] : 0;
        },
        set: (value: ParamValue) => {
          const live = chain?.resolveTarget(id, prop);
          if (live) (live.obj as Record<string, ParamValue>)[live.key] = value;
        },
      });
    }
    return { obj: proxy, key: prop, kind: tw.kind };
  }

  const node: ThreeNode = {
    id: layer.id,
    layer,
    display,
    content,
    start,
    end,
    children: [],
    alpha,
    warnings,
    errors,
    get rig() {
      return rig;
    },

    size: () => ({ width, height }),

    cameraState() {
      if (!rig) return null;
      return {
        position: [rig.restPosition.x, rig.restPosition.y, rig.restPosition.z] as [number, number, number],
        lookAt: [rig.lookAt.x, rig.lookAt.y, rig.lookAt.z] as [number, number, number],
        fov: rig.camera.fov,
      };
    },

    frameShot(shot: ShotSpec) {
      if (!rig) return null;
      const box = subjectBox(rig, shot.subject);
      if (!box) return null;
      const framed = frameShotBySpec(shot, box, layer.width / layer.height);
      return { position: framed.position, lookAt: framed.lookAt, fov: framed.fov };
    },

    resolveTargets(targetName, prop) {
      const unit = parseUnitTarget(targetName);
      if (!unit || !rig) return null;
      const text = rig.texts.get(unit.id);
      return text ? resolveUnitTargets(text, unit.kind, prop) : null;
    },

    resolveTarget(targetName, prop) {
      if (targetName === undefined) return resolveBaseTarget(node, prop);
      if (targetName === 'camera') return rig ? resolveCameraTarget(rig, rigOffsets, prop) : null;

      const objectPrefix = 'object:';
      if (targetName.startsWith(objectPrefix)) {
        const wrapper = rig?.objects.get(targetName.slice(objectPrefix.length));
        return wrapper ? resolveObjectTarget(wrapper, prop) : null;
      }

      if (targetName === 'lighting') {
        if (!(LIGHTING_TWEEN_PROPS as readonly string[]).includes(prop)) return null;
        // Stable across the async rig build: the accessors find the live rig on every write.
        return { obj: lightingProxy, key: prop, kind: 'number' };
      }

      const lightPrefix = 'light:';
      if (targetName.startsWith(lightPrefix)) {
        const light = rig?.lights.get(targetName.slice(lightPrefix.length));
        return light ? resolveLightTarget(light, prop) : null;
      }

      const effectPrefix = 'effect:';
      if (targetName.startsWith(effectPrefix)) {
        return resolveEffectTarget(targetName.slice(effectPrefix.length), prop);
      }
      return null;
    },

    applyOpacity(effective) {
      plane.setAlpha(effective);
    },

    setBackdrop(texture, stage) {
      plane.setBackdrop?.(texture, stage);
    },

    update(timeSec) {
      if (destroyed || !rig || !chain) return;

      const localSec = timeSec - start;
      for (const entry of rig.mixers) {
        entry.mixer.setTime(clipTime(localSec, entry.clip.duration, entry.animation));
      }

      // The camera at `cameraSec` on its path, the world at `localSec`. A path declares the camera, so it is sampled
      // statelessly from the time alone and lands before the camera looks at its target.
      const pose = (cameraSec: number): void => {
        if (!rig) return;
        const path = layer.camera.path;
        if (path) {
          const sample = samplePath(path, cameraSec, layer.camera.fov);
          rig.restPosition.set(sample.position[0], sample.position[1], sample.position[2]);
          rig.lookAt.set(sample.lookAt[0], sample.lookAt[1], sample.lookAt[2]);
          if (pathOwnsFov) rig.camera.fov = sample.fov;
        }
        // The camera stands on its rest pose; the rig moves (pan, tilt, roll, dolly, truck, pedestal)
        // ride on top of it.
        applyRig(rig.camera, { position: rig.restPosition, lookAt: rig.lookAt }, rigOffsets);
        if (rig.camera.fov !== lastFov) {
          lastFov = rig.camera.fov;
          rig.camera.updateProjectionMatrix();
        }
        // Life, swarms, flipbooks and billboards; billboards need the camera's final orientation.
        rig.camera.updateMatrixWorld(true);
        rig.tick(warpClock(layer.timeWarp, localSec));
      };

      // A transition is playing when its window holds this time and its shader is known and usable.
      const active = renderer && glLib ? transitions.find((t) => localSec >= t.at && localSec < t.at + t.duration) : undefined;
      const def = active ? glLib!.find(active.name) : undefined;

      try {
        if (active && def && usable(def) && renderer) {
          mixer ??= new TransitionRenderer(width, height);
          // the old shot's last picture: its camera pose just before the cut, the world as it is now
          pose(Math.max(0, active.at - 1e-3));
          renderChain(chain, renderer);
          mixer.copy(renderer, target.texture, mixer.from);
          // the new shot, then the mix of the two put back into the layer's own target
          pose(localSec);
          renderChain(chain, renderer);
          mixer.mix(renderer, def, target.texture, (localSec - active.at) / active.duration, active.params);
          mixer.copy(renderer, mixer.out.texture, target);
        } else {
          pose(localSec);
          // A test chain ignores the renderer; a real one always has it.
          renderChain(chain, renderer);
        }
        settleReady();
      } catch (error) {
        reportError(error);
      }
    },

    ready: glLoad ? Promise.all([ready, glLoad]).then(() => undefined) : ready,

    destroy() {
      if (destroyed) return;
      destroyed = true;
      chain?.dispose();
      chain = null;
      mixer?.dispose();
      mixer = null;
      rig?.dispose();
      rig = null;
      target.dispose();
      planeGeometry.dispose();
      plane.dispose();
      display.removeFromParent();
    },
  };

  const buildRig = (assets?: PreloadedThreeAssets): void => {
    if (assets) {
      for (const failure of assets.errors) {
        warnings.push(`three asset ${failure.assetId}: ${String(failure.error)}`);
      }
    }
    const built = buildScene(layer, {
      textures: assets?.textures,
      gltfs: assets?.gltfs,
      fonts: assets?.fonts,
      renderer: renderer ?? undefined,
    });
    warnings.push(...built.warnings);
    rig = built;

    // A shot declares the framing, so it replaces the camera's numbers once the rig exists and the
    // subject's world box is known. This is the camera's rest pose: the tweens move away from it.
    const shot = layer.camera.shot;
    if (shot) {
      const box = subjectBox(built, shot.subject);
      if (box) {
        const framed = frameShotBySpec(shot, box, layer.width / layer.height);
        built.restPosition.set(framed.position[0], framed.position[1], framed.position[2]);
        built.lookAt.set(framed.lookAt[0], framed.lookAt[1], framed.lookAt[2]);
        built.camera.fov = framed.fov;
        built.camera.updateProjectionMatrix();
        lastFov = framed.fov;
      } else {
        warnings.push(`camera.shot subject "${shot.subject}" has nothing to frame`);
      }
    }

    // The camera stands on its rest pose; the rig moves ride on top of it.
    applyRig(built.camera, { position: built.restPosition, lookAt: built.lookAt }, rigOffsets);

    try {
      chain = buildEffectChain({
        renderer,
        scene: built.scene,
        camera: built.camera,
        effects: layer.effects,
        size: { width, height },
        output: target,
        toneMapping: true,
      });
      warnings.push(...chain.errors);
    } catch (error) {
      chain = null;
      readySettled = true;
      rejectReady(error);
      return;
    }
    // Without a renderer (unit tests) nothing draws, so the node is ready as soon as it is built.
    if (!renderer) {
      settleReady();
      return;
    }
    // A built rig only draws on the next `update(timeSec)` call from the clock, which may not come
    // for a while (a paused player that never seeks again after an async asset resolves). Render
    // once here too, so `ready` settles as soon as the rig is actually drawable, not just built.
    try {
      renderChain(chain, renderer);
      settleReady();
    } catch (error) {
      reportError(error);
      settleReady();
    }
  };

  const startRig = (): void => {
    const preloaded = ctx.preloaded?.get(layer.id);
    if (preloaded) {
      buildRig(preloaded);
    } else if (needsAsyncAssets(layer)) {
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
  };
  // The rig is built at once (tweens bind to its objects as soon as the timeline is made); a layer with transitions only holds its
  // `ready` until the shader list is in, so the first frame that is rendered for export or a seek already has them.
  startRig();

  return node;
}
