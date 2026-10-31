// Ported from reacthub-pixitweenjs src/components/AepComposition/model3d/animation.ts (MIT).
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

// glTF loading, normalisation and stateless clip timing. Seeking must be reliable: rather than
// letting an AnimationAction run free (a LoopOnce action pauses itself and then ignores
// `mixer.setTime` on a seek back), every update scrubs the mixer to an absolute clip time.

/** The slice of the loaded asset this layer needs (the loader also returns cameras and scenes). */
export type LoadedGltf = GLTF;

/** Clip metadata the timing helpers need (a `THREE.AnimationClip` satisfies this). */
export interface NamedClip {
  name: string;
  duration: number;
}

/** Load a glTF/GLB asset with three's own loader (used for the layer's `gltf` assets). */
export function loadGltf(url: string): Promise<LoadedGltf> {
  return new GLTFLoader().loadAsync(url);
}

export interface NormalizeGltfOptions {
  /** When set, scale the model uniformly so its bounding-box height equals this many units. */
  height?: number;
}

/**
 * Put a loaded glTF scene on the floor: centre it on x and z, drop its bottom to y = 0, and (when
 * `height` is set) scale it uniformly so the bounding-box height matches. Returns the resulting
 * world-space box so a caller can frame a camera or fit the shadow without re-measuring.
 */
export function normalizeGltf(root: THREE.Object3D, options: NormalizeGltfOptions = {}): THREE.Box3 {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());

  if (options.height !== undefined && size.y > 0) {
    root.scale.multiplyScalar(options.height / size.y);
    root.updateMatrixWorld(true);
    box.setFromObject(root);
  }

  const center = box.getCenter(new THREE.Vector3());
  root.position.x -= center.x;
  root.position.z -= center.z;
  root.position.y -= box.min.y;
  root.updateMatrixWorld(true);

  return new THREE.Box3().setFromObject(root);
}

/**
 * Pick the clip a `clip` selector refers to. A name (or index) that is not found falls back to the
 * first clip and returns a `warning` naming the one that was missing, so the node can record it.
 */
export function pickClip<T extends NamedClip>(
  clips: readonly T[],
  name?: string | number,
): { clip: T; warning?: string } | null {
  if (clips.length === 0) return null;
  if (name === undefined) return { clip: clips[0] };
  const found = typeof name === 'number' ? clips[name] : clips.find((clip) => clip.name === name);
  if (found) return { clip: found };
  return {
    clip: clips[0],
    warning: `animation clip ${JSON.stringify(name)} not found; using ${JSON.stringify(
      clips[0].name,
    )}. Available: ${clips.map((clip) => clip.name).join(', ')}`,
  };
}

// Keeps a held clip just inside its last keyframe; at exactly `duration` a repeating action wraps
// back to the first pose.
export const HOLD_EPSILON = 1e-4;

export interface ClipTimeOptions {
  speed: number;
  loop: boolean;
  offset: number;
}

/**
 * Seconds to scrub a mixer to for a given local time: looping wraps
 * `((localSec - offset) * speed)` into `[0, clipDuration)`; not looping clamps to
 * `clipDuration - HOLD_EPSILON`. Before the offset the clip is not playing yet (0). Stateless, so a
 * seek back to an earlier time draws the earlier pose.
 */
export function clipTime(localSec: number, clipDuration: number, options: ClipTimeOptions): number {
  const local = localSec - options.offset;
  if (local < 0) return 0;
  const time = local * options.speed;
  if (clipDuration <= 0) return time;
  if (options.loop) {
    const wrapped = time % clipDuration;
    return wrapped < 0 ? wrapped + clipDuration : wrapped;
  }
  return Math.min(time, clipDuration - HOLD_EPSILON);
}
