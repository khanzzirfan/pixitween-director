import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { type Object3D as Object3DSpec } from '../../schema/layer3d';
import { disposeObject3D } from './dispose';
import { buildGeometry } from './geometry';
import { normalizeGltf, pickClip, type LoadedGltf } from './gltf';
import { makeMaterial } from './materials';

// One object of a `three` layer. A primitive is a single mesh; a glTF is a clone of the loaded
// scene (SkeletonUtils.clone so skinned models keep their skeletons), dropped onto the floor. Both
// hang off a wrapper Group the tweens move, so `object:<id>` never disturbs the normalised child.

export interface ObjectBuildContext {
  /** Loaded image assets by asset id (from `preloadThreeAssets`). */
  textures?: ReadonlyMap<string, THREE.Texture>;
  /** Loaded glTF assets by asset id (from `preloadThreeAssets`). */
  gltfs?: ReadonlyMap<string, LoadedGltf>;
}

export interface BuiltObject {
  /** Wrapper Group carrying the spec's position, rotation (radians) and scale. */
  root: THREE.Group;
  mixer?: THREE.AnimationMixer;
  clip?: THREE.AnimationClip;
  warnings: string[];
  dispose: () => void;
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

  if (spec.geometry.type === 'gltf') {
    shared = true;
    const loaded = ctx.gltfs?.get(spec.geometry.asset);
    if (!loaded) {
      warnings.push(`gltf asset ${JSON.stringify(spec.geometry.asset)} is not loaded`);
    } else {
      const content = cloneSkinned(loaded.scene);
      normalizeGltf(content, { height: spec.geometry.height });
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
  } else {
    const geometry = buildGeometry(spec.geometry);
    const mesh = new THREE.Mesh(geometry, makeMaterial(spec.material, ctx.textures));
    root.add(mesh);
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
    // A glTF clone shares geometry, materials and textures with the loaded asset, so it frees
    // nothing itself (the rig disposes the loaded glTF once). `onlyOwned` leaves shared resources.
    disposeObject3D(root, shared ? { onlyOwned: true } : {});
  };

  return { root, mixer, clip, warnings, dispose };
}
