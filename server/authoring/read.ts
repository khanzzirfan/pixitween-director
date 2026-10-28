import { AuthoringError, hintList } from './errors';
import { readDirector, sceneIds, writeDirector } from './meta';
import type { Comp, LayerRole, Obj } from './types';

const precomps = (c: Comp) => (c.precomps ?? {}) as Record<string, Obj>;

export function sceneInfo(c: Comp): Array<{ id: string; startSec: number; durationSec: number; mode: 'motion' | 'generate'; layerIds: string[] }> {
  const meta = readDirector(c);
  return sceneIds(c).map((id) => {
    const m = meta.scenes[id]!;
    return {
      id,
      startSec: m.startFrame / c.fps,
      durationSec: m.durationFrames / c.fps,
      mode: m.mode,
      layerIds: ((precomps(c)[id]?.layers ?? []) as Obj[]).map((l) => l.id as string),
    };
  });
}

export function layerInfo(c: Comp, layerId: string): { id: string; sceneId: string; role: LayerRole; kind: string; assetId?: string; z?: number } {
  const m = readDirector(c).layers[layerId];
  const layer = m ? ((precomps(c)[m.sceneId]?.layers ?? []) as Obj[]).find((l) => l.id === layerId) : undefined;
  if (!m || !layer) throw new AuthoringError('unknown_layer', `no layer '${layerId}'`, hintList(Object.keys(readDirector(c).layers)));
  return { id: layerId, sceneId: m.sceneId, role: m.role, kind: layer.kind, ...(m.assetId ? { assetId: m.assetId } : {}), ...(m.z !== undefined ? { z: m.z } : {}) };
}

export function layerIdsByRole(c: Comp, role: LayerRole, sceneId?: string): string[] {
  return Object.entries(readDirector(c).layers)
    .filter(([, m]) => m.role === role && (sceneId === undefined || m.sceneId === sceneId))
    .map(([id]) => id);
}

export function markPlaceholder(c: Comp, layerId: string, flag: boolean): Comp {
  const meta = readDirector(c);
  const m = meta.layers[layerId];
  if (!m) throw new AuthoringError('unknown_layer', `no layer '${layerId}'`, hintList(Object.keys(meta.layers)));
  if (flag) m.placeholder = true;
  else delete m.placeholder;
  return writeDirector(c, meta);
}
