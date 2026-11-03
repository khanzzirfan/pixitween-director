import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { type Object3D as Object3DSpec } from '../../schema/layer3d';
import { disposeObject3D } from './dispose';
import { buildGeometry } from './geometry';
import { normalizeGltf, pickClip, type LoadedGltf } from './gltf';
import { makeMaterial, makeUnlitMaterial } from './materials';
import { buildCaustics } from './caustics';
import { buildLiquid } from './liquid';
import { buildMirror } from './mirror';
import { buildRunners, roundProfile } from './runners';
import { buildSmoke } from './smoke';
import { buildSwarm } from './swarm';
import { buildText3D, type Text3DResult } from '../text/build';
import { recordText3DStats } from '../text/debug';
import type { Font } from 'three/examples/jsm/loaders/FontLoader.js';

// One object of a `three` layer. A primitive is a single mesh; a glTF is a clone of the loaded
// scene (SkeletonUtils.clone so skinned models keep their skeletons), dropped onto the floor. Both
// hang off a wrapper Group the tweens move, so `object:<id>` never disturbs the normalised child.

export interface ObjectBuildContext {
  /** Loaded image assets by asset id (from `preloadThreeAssets`). */
  textures?: ReadonlyMap<string, THREE.Texture>;
  /** Loaded glTF assets by asset id (from `preloadThreeAssets`). */
  gltfs?: ReadonlyMap<string, LoadedGltf>;
  /** Loaded fonts by asset id (from `preloadThreeAssets`). */
  fonts?: ReadonlyMap<string, Font>;
  /** The size of the frame the scene is drawn in (a mirror floor draws its reflection to match). */
  viewport?: { width: number; height: number };
}

export interface BuiltObject {
  /** Wrapper Group carrying the spec's position, rotation (radians) and scale. */
  root: THREE.Group;
  mixer?: THREE.AnimationMixer;
  clip?: THREE.AnimationClip;
  /** The glyph hierarchy of a text3d object (for unit targets). */
  text?: Text3DResult;
  /** Per-frame work for life, billboard, flipbook and swarm: `localSec` is the layer clock. Absent when none applies. */
  tick?: (localSec: number, camera: THREE.Camera) => void;
  warnings: string[];
  dispose: () => void;
}

const FIT_BOX = new THREE.Box3();
const FIT_SIZE = new THREE.Vector3();
const FIT_CENTER = new THREE.Vector3();

/** Scales `object` so its largest side is `size`, then stands it on y = 0 centred in x and z. */
function fitToSize(object: THREE.Object3D, size: number): void {
  object.updateMatrixWorld(true);
  FIT_BOX.setFromObject(object, true).getSize(FIT_SIZE);
  const largest = Math.max(FIT_SIZE.x, FIT_SIZE.y, FIT_SIZE.z);
  object.scale.multiplyScalar(largest > 1e-9 ? size / largest : 1);
  object.updateMatrixWorld(true);
  FIT_BOX.setFromObject(object, true).getCenter(FIT_CENTER);
  object.position.x -= FIT_CENTER.x;
  object.position.z -= FIT_CENTER.z;
  object.position.y -= FIT_BOX.min.y;
  object.updateMatrixWorld(true);
}

export function buildObject(spec: Object3DSpec, ctx: ObjectBuildContext = {}): BuiltObject {
  const warnings: string[] = [];
  const root = new THREE.Group();
  root.name = spec.id;
  root.position.set(spec.position[0], spec.position[1], spec.position[2]);
  // Rotations are authored in degrees; the object itself holds radians (engine/docs/04-three.md,
  // "Rotations").
  root.rotation.set(
    THREE.MathUtils.degToRad(spec.rotation[0]),
    THREE.MathUtils.degToRad(spec.rotation[1]),
    THREE.MathUtils.degToRad(spec.rotation[2]),
  );
  if (typeof spec.scale === 'number') root.scale.setScalar(spec.scale);
  else root.scale.set(spec.scale[0], spec.scale[1], spec.scale[2]);

  let mixer: THREE.AnimationMixer | undefined;
  let clip: THREE.AnimationClip | undefined;
  let shared = false;
  let disposeText: (() => void) | undefined;
  let textResult: Text3DResult | undefined;
  let flipMaterial: THREE.MeshBasicMaterial | THREE.MeshStandardMaterial | undefined;
  let swarmTime: ((t: number) => void) | undefined;
  let disposeMirror: (() => void) | undefined;

  if (spec.geometry.type === 'gltf') {
    shared = true;
    const loaded = ctx.gltfs?.get(spec.geometry.asset);
    if (!loaded) {
      warnings.push(`gltf asset ${JSON.stringify(spec.geometry.asset)} is not loaded`);
    } else {
      const content = cloneSkinned(loaded.scene);
      if (spec.fit !== undefined) fitToSize(content, spec.fit);
      else normalizeGltf(content, { height: spec.geometry.height });
      root.add(content);
      if (spec.animation) {
        const picked = pickClip(loaded.animations, spec.animation.clip);
        if (!picked) {
          warnings.push(`gltf asset ${JSON.stringify(spec.geometry.asset)} has no animation clips`);
        } else {
          if (picked.warning) warnings.push(picked.warning);
          mixer = new THREE.AnimationMixer(content);
          mixer.clipAction(picked.clip).play();
          clip = picked.clip;
        }
      }
    }
  } else if (spec.geometry.type === 'text3d') {
    const font = ctx.fonts?.get(spec.geometry.font);
    if (!font) {
      warnings.push(`font asset ${JSON.stringify(spec.geometry.font)} is not loaded (text3d object ${JSON.stringify(spec.id)})`);
    } else {
      const text = buildText3D(spec.geometry, font, makeMaterial(spec.material, ctx.textures));
      root.add(text.root);
      recordText3DStats(spec.id, text.stats);
      for (const w of text.warnings) warnings.push(`${w} (object ${JSON.stringify(spec.id)})`);
      disposeText = text.dispose;
      textResult = text;
    }
  } else if (spec.geometry.type === 'mirror') {
    const mirror = buildMirror({ size: spec.geometry.size, strength: spec.geometry.strength, fade: spec.geometry.fade, ...(spec.geometry.blur !== undefined ? { blur: spec.geometry.blur } : {}), viewport: ctx.viewport ?? { width: 512, height: 512 } });
    root.add(mirror);
    disposeMirror = () => mirror.dispose();
  } else if (spec.geometry.type === 'caustics') {
    const rig = buildCaustics({ size: spec.geometry.size, strength: spec.geometry.strength, fade: spec.geometry.fade, scale: spec.geometry.scale, color: spec.material.color });
    root.add(rig.mesh);
    swarmTime = rig.setTime;
  } else if (spec.geometry.type === 'smoke') {
    // Vapour changes every frame and faces the camera, so like a liquid it is never fitted.
    const rig = buildSmoke({ form: spec.geometry.form, duration: spec.geometry.duration, size: spec.geometry.size, color: spec.material.color, opacity: spec.material.opacity, ...(spec.geometry.seed !== undefined ? { seed: spec.geometry.seed } : {}) });
    root.add(rig.mesh);
    swarmTime = rig.setTime;
  } else if (spec.geometry.type === 'liquid') {
    // A liquid changes shape every frame, so it is never fitted: its box is `size` across, on the origin.
    const rig = buildLiquid(spec.geometry, makeMaterial(spec.material, ctx.textures));
    root.add(rig.mesh);
    swarmTime = rig.setTime;
  } else {
    const geometry = buildGeometry(spec.geometry);
    let material: THREE.Material | THREE.Material[];
    if (spec.material.unlit) {
      material = makeUnlitMaterial(spec.material, ctx.textures);
    } else {
      material = makeMaterial(spec.material, ctx.textures);
      if (spec.geometry.type === 'extrude' && spec.geometry.sideColor) {
        // Caps carry the map, the sides a plain colour.
        material = [material, makeMaterial({ ...spec.material, map: undefined, color: spec.geometry.sideColor }, ctx.textures)];
      }
      if (spec.geometry.type === 'lathe' && spec.material.map) {
        // The lathe's u seam faces +z, which would split the label down the middle; half a turn
        // puts the label's centre on the front.
        const texture = ctx.textures?.get(spec.material.map);
        if (texture) texture.offset.x = 0.5;
      }
    }
    flipMaterial = (Array.isArray(material) ? material[0] : material) as THREE.MeshBasicMaterial | THREE.MeshStandardMaterial;
    const mesh = new THREE.Mesh(geometry, material);
    // Cards draw after the opaque objects so they blend over them.
    if (spec.material.unlit) mesh.renderOrder = 1;
    if (spec.fit !== undefined) fitToSize(mesh, spec.fit);
    if (spec.swarm) {
      const swarm = buildSwarm(mesh, spec.swarm);
      // The instanced copy took a baked clone of the geometry; the source mesh is not drawn.
      geometry.dispose();
      root.add(swarm.mesh);
      swarmTime = swarm.setTime;
    } else {
      root.add(mesh);
      if (!spec.material.unlit && (spec.material.condensation ?? 0) > 0) {
        // A wet, round body has drops running down it (a box or a card keeps its still beads only).
        mesh.updateMatrix();
        const round = roundProfile(geometry, mesh.matrix);
        if (round) {
          const runners = buildRunners({ ...round, amount: spec.material.condensation ?? 0 });
          root.add(runners.mesh);
          swarmTime = runners.setTime;
        }
      }
    }
  }

  let tick: BuiltObject['tick'];
  const flipFrames = spec.flipbook ? spec.flipbook.frames.map((id) => ctx.textures?.get(id)) : [];
  if (spec.life || spec.billboard || spec.flipbook || swarmTime) {
    const roll = THREE.MathUtils.degToRad(spec.rotation[2]);
    let lastFrame = -1;
    tick = (localSec, camera) => {
      const start = spec.life?.start ?? 0;
      // In the scene from its start up to (not including) its end, like a layer's in/out points.
      if (spec.life) root.visible = localSec >= start && localSec < spec.life.end;
      if (!root.visible) return;
      const t = Math.max(0, localSec - start);
      swarmTime?.(t);
      if (spec.billboard) {
        root.quaternion.copy(camera.quaternion);
        root.rotateZ(roll);
      }
      if (spec.flipbook && flipMaterial) {
        const n = flipFrames.length;
        const raw = Math.floor(t * spec.flipbook.fps);
        const frame = spec.flipbook.loop ? raw % n : Math.min(raw, n - 1);
        const texture = flipFrames[frame];
        if (texture && frame !== lastFrame) {
          lastFrame = frame;
          texture.wrapS = THREE.ClampToEdgeWrapping;
          texture.wrapT = THREE.ClampToEdgeWrapping;
          texture.colorSpace = THREE.SRGBColorSpace;
          flipMaterial.map = texture;
          flipMaterial.needsUpdate = true;
        }
      }
    };
  }

  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = spec.castShadow;
    mesh.receiveShadow = true;
  });

  const dispose = () => {
    mixer?.stopAllAction();
    root.removeFromParent();
    disposeText?.();
    disposeMirror?.();
    // A glTF clone shares geometry, materials and textures with the loaded asset, so it frees
    // nothing itself (the rig disposes the loaded glTF once). `onlyOwned` leaves shared resources.
    disposeObject3D(root, shared ? { onlyOwned: true } : {});
  };

  return { root, mixer, clip, text: textResult, tick, warnings, dispose };
}
