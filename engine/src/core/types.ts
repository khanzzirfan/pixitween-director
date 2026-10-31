import type { Container, Filter, Application, Texture } from 'pixi.js';
import type { TargetRef } from './paths';
import type { Layer, MotionDoc } from '../schema';

export interface MotionNode {
  readonly id: string;
  readonly layer: Layer;
  /** The Pixi object placed in the parent. Its transform (x, y, rotation, scale, alpha, pivot) is the layer's. */
  readonly display: Container;
  /** Absolute doc seconds (a group child's times are already offset by its ancestors). */
  readonly start: number;
  readonly end: number;
  readonly children: MotionNode[];
  /** Unscaled local size, for presets. */
  size(): { width: number; height: number };
  /** Allowlisted tween targets; null when not allowed. */
  resolveTarget(target: string | undefined, prop: string): TargetRef | null;
  /** Called on every clock update while visible. Optional. */
  update?(timeSec: number): void;
  /** Resolves when the node can draw its first frame; rejects with the layer's error. */
  readonly ready: Promise<void>;
  destroy(): void;
}

export interface NodeContext {
  doc: MotionDoc;
  textures: ReadonlyMap<string, Texture>;
  app: Application | null;
  /** Layer filters are attached by the runtime (m7) through this hook so m3 does not depend on m5. */
  attachFilters?(node: MotionNode, filters: Filter[]): void;
}

export type NodeFactory = (layer: Layer, ctx: NodeContext, parentStart: number) => MotionNode;
