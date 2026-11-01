import type * as THREE from 'three';
import type { TargetRef } from './paths';
import type { Layer, MotionDoc } from '../schema';
import type { ShotSpec } from '../schema/shot';
import type { PreloadedThreeAssets } from '../three/build/scene';

// The MotionNode contract (engine/docs/03-stage-2d.md): every layer becomes one node on the Three stage.

/**
 * A camera's rest pose and lens: where it stands, what it looks at and how wide the lens is
 * (engine/docs/09-camera.md). The camera presets read it to build their moves.
 */
export interface CameraState {
  position: [number, number, number];
  lookAt: [number, number, number];
  fov: number;
}

export interface MotionNode {
  readonly id: string;
  readonly layer: Layer;
  /** Added to the parent. Carries the layer transform (position, rotation, scale). */
  readonly display: THREE.Object3D;
  /** Holds the node's meshes, offset by the anchor. Isolation renders this group alone. */
  readonly content: THREE.Object3D;
  /** Absolute doc seconds (group children are offset by their ancestors). */
  readonly start: number;
  readonly end: number;
  readonly children: MotionNode[];
  /** Unscaled local size in pixels, for presets and isolation bounds. */
  size(): { width: number; height: number };
  /** Allowlisted tween targets; null when not allowed. */
  resolveTarget(target: string | undefined, prop: string): TargetRef | null;
  /** Multi-unit targets (`glyphs:<id>`, `words:<id>`, `lines:<id>`): one ref per unit; null when not allowed. */
  resolveTargets?(target: string, prop: string): TargetRef[] | null;
  /** The camera's rest pose and lens (three layers); null when the layer has no camera yet. */
  cameraState?(): CameraState | null;
  /** Frames a shot against this layer's own objects (three layers); null when it frames nothing. */
  frameShot?(shot: ShotSpec): CameraState | null;
  /** The node's own alpha (0..1), set by the base `alpha` target. */
  readonly alpha: { value: number };
  /** Sets the effective opacity (own alpha × ancestors) on every material the node owns (not its children's). */
  applyOpacity(effective: number): void;
  /** Called on every clock update while visible (3D render, isolated effects, text redraw). */
  update?(timeSec: number, frame: number): void;
  readonly ready: Promise<void>;
  /** Non-fatal problems (missing clip, missing glyph, …). */
  readonly warnings: string[];
  destroy(): void;
}

export interface NodeContext {
  doc: MotionDoc;
  /** Image assets by asset id. */
  textures: ReadonlyMap<string, THREE.Texture>;
  /** The player's one renderer; null in unit tests. */
  renderer: THREE.WebGLRenderer | null;
  /**
   * Three-layer assets already loaded by the runtime, by layer id. A node that finds its entry builds
   * its rig synchronously, so tweens on `object:`/`glyphs:` targets compile against a real rig.
   */
  preloaded?: ReadonlyMap<string, PreloadedThreeAssets>;
}

export type NodeFactory = (layer: Layer, ctx: NodeContext, parentStart: number) => MotionNode;
