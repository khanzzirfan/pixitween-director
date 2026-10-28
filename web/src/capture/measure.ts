import type { Rect } from './fit';
import { fitTransform, toCompSpace, type Size } from './fit';

/** The minimal Pixi shape the measurement needs: a node with children, a label and bounds. */
export interface PixiNodeLike {
  label?: string;
  text?: unknown;
  children?: PixiNodeLike[];
  getBounds?(): Rect;
  getChildByLabel?(label: string, deep?: boolean): PixiNodeLike | null;
}
export interface PixiStageLike {
  getChildByLabel?(label: string, deep?: boolean): PixiNodeLike | null;
}

/** Depth-first search for the first text node below `node`, however deeply it is nested. */
export function findTextNode(node: PixiNodeLike): PixiNodeLike | undefined {
  for (const child of node.children ?? []) {
    if (child.text !== undefined) return child;
    const found = findTextNode(child);
    if (found) return found;
  }
  return undefined;
}

/**
 * Measures each text layer's rendered rectangle in composition pixels. Layers without a labelled container
 * or without a text node are left out, so the rules fall back to their estimate for them.
 */
export function measureTextBoxes(
  stage: PixiStageLike,
  screen: Size,
  comp: Size,
  layerIds: string[],
): Record<string, { left: number; top: number; right: number; bottom: number }> {
  const t = fitTransform(screen, comp);
  const out: Record<string, { left: number; top: number; right: number; bottom: number }> = {};
  for (const id of layerIds) {
    const container = stage.getChildByLabel?.(`container-${id}`, true);
    if (!container) continue;
    const text = findTextNode(container);
    const bounds = text?.getBounds?.();
    if (!bounds) continue;
    out[id] = toCompSpace(bounds, t);
  }
  return out;
}
