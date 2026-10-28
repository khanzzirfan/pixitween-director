import type { AepCompositionJson } from 'reacthub-pixitweenjs';
export const LAYER_LABEL_PREFIX = 'container-';
export type PixiNodeLike = {
  label?: string | null;
  parent?: PixiNodeLike | null;
  children?: PixiNodeLike[];
  visible?: boolean;
  eventMode?: string;
  getBounds?(): { containsPoint(x: number, y: number): boolean };
};
export const layerIdFromLabel = (label: unknown): string | null =>
  typeof label === 'string' && label.startsWith(LAYER_LABEL_PREFIX) && label.length > LAYER_LABEL_PREFIX.length
    ? label.slice(LAYER_LABEL_PREFIX.length)
    : null;
export function containerFromPixiTarget(target: PixiNodeLike | null, maxDepth = 200): PixiNodeLike | null {
  let n = target;
  const seen = new Set<PixiNodeLike>();
  for (let i = 0; n && i < maxDepth; i++) {
    if (seen.has(n)) return null;
    seen.add(n);
    if (layerIdFromLabel(n.label)) return n;
    n = n.parent ?? null;
  }
  return null;
}
export function layerIdFromPixiTarget(target: PixiNodeLike | null, maxDepth = 200): string | null {
  let n = target;
  const seen = new Set<PixiNodeLike>();
  for (let i = 0; n && i < maxDepth; i++) {
    if (seen.has(n)) return null;
    seen.add(n);
    const id = layerIdFromLabel(n.label);
    if (id) return id;
    n = n.parent ?? null;
  }
  return null;
}
export function innermostLayerAt(
  container: PixiNodeLike,
  point: { x: number; y: number },
  opts: { isSelectable?(id: string): boolean } = {},
): string | null {
  const walk = (node: PixiNodeLike, seen: Set<PixiNodeLike>): string | null => {
    if (seen.has(node) || node.visible === false || node.eventMode === 'none') return null;
    seen.add(node);
    const children = node.children ?? [];
    for (let i = children.length - 1; i >= 0; i--) {
      const id = walk(children[i]!, seen);
      if (id) return id;
    }
    const id = layerIdFromLabel(node.label);
    if (id && opts.isSelectable?.(id) === false) return null;
    if (id && node.getBounds?.().containsPoint(point.x, point.y)) return id;
    return null;
  };
  return walk(container, new Set());
}
export function resolveLayerId(
  target: PixiNodeLike | null,
  point: { x: number; y: number },
  opts: { isSelectable?(id: string): boolean } = {},
): string | null {
  const container = containerFromPixiTarget(target);
  return container ? (innermostLayerAt(container, point, opts) ?? layerIdFromPixiTarget(target)) : layerIdFromPixiTarget(target);
}
export function selectionFromLayerId(comp: AepCompositionJson, id: string): { sceneId?: string; layerId?: string } | null {
  const meta = (comp.meta as any)?.director?.layers?.[id];
  if (meta) return { sceneId: meta.sceneId, layerId: id };
  const root = (comp.layers as any[]).find((l) => l.id === id && l.kind === 'precomp');
  return root ? { sceneId: root.compId } : null;
}
