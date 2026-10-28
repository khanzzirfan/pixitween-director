import type { AepCompositionJson, AepLayer } from 'reacthub-pixitweenjs';
export class EditError extends Error {
  constructor(
    message: string,
    readonly nearest: string[] = [],
  ) {
    super(message);
    this.name = 'EditError';
  }
}
export function isKeyframes(v: unknown): v is Array<{ t: number; v: unknown }> {
  return Array.isArray(v) && v.length > 0 && typeof v[0] === 'object' && v[0] !== null && typeof (v[0] as any).t === 'number';
}
export function mapAnimatable<T>(
  v: T | Array<{ t: number; v: T; [key: string]: unknown }>,
  fn: (x: T) => T,
): T | Array<{ t: number; v: T; [key: string]: unknown }> {
  if (!isKeyframes(v)) return fn(v as T);
  return v.map((key) => ({ ...key, v: fn(key.v as T) }));
}
function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = temp;
    }
  }
  return row[b.length]!;
}
export function findLayer(comp: AepCompositionJson, layerId: string): { layer: AepLayer; container: AepLayer[]; sceneId: string | null } {
  const roots = comp.layers as AepLayer[];
  const root = roots.find((l) => l.id === layerId);
  if (root) return { layer: root, container: roots, sceneId: null };
  for (const [sceneId, raw] of Object.entries(comp.precomps ?? {})) {
    const container = (raw as any).layers as AepLayer[];
    const layer = container?.find((l) => l.id === layerId);
    if (layer) return { layer, container, sceneId };
  }
  const ids = [
    ...roots.map((l) => l.id),
    ...Object.values(comp.precomps ?? {}).flatMap((p: any) => p.layers?.map((l: AepLayer) => l.id) ?? []),
  ];
  const nearest = ids
    .map((id) => ({ id, d: distance(layerId, id) }))
    .sort((a, b) => a.d - b.d || a.id.localeCompare(b.id))
    .slice(0, 8)
    .map((x) => x.id);
  throw new EditError(`unknown layer id '${layerId}'. Nearest ids: ${nearest.join(', ') || 'none'}`, nearest);
}
export const frameSize = (comp: AepCompositionJson) => ({ width: comp.width, height: comp.height });
