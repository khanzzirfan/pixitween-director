import type { AepCompositionJson } from 'reacthub-pixitweenjs';

type L = { id: string; role: string; assetId?: string; kind?: string; position?: [number, number]; anchor?: [number, number]; scale?: [number, number]; hidden?: boolean };
const tr = (l: L) => ({ position: l.position ?? [960, 540], anchor: l.anchor ?? [0, 0], scale: l.scale ?? [1, 1], rotation: 0, opacity: 1 });

/** A hand-built film composition with scenes (mode, frames) and optional image layers per scene. */
export function buildComp(scenes: Array<{ id: string; mode?: 'motion' | 'generate'; frames?: number; layers?: L[]; intent?: string }>): AepCompositionJson {
  const precomps: Record<string, unknown> = {};
  const metaScenes: Record<string, unknown> = {};
  const metaLayers: Record<string, unknown> = {};
  let start = 0;
  const assets: Record<string, unknown> = {};
  const root: unknown[] = [];
  for (const s of scenes) {
    const frames = s.frames ?? 120;
    const layers: Array<Record<string, any>> = (s.layers ?? []).map((l) => {
      metaLayers[l.id] = { sceneId: s.id, role: l.role, ...(l.assetId ? { assetId: l.assetId } : {}) };
      if (l.assetId) assets[l.assetId] = { type: 'image', src: `/api/assets/${l.assetId}` };
      return { kind: l.kind ?? (l.assetId ? 'image' : 'shape'), id: l.id, inPoint: 0, outPoint: frames, ...(l.assetId ? { assetId: l.assetId } : { path: { kind: 'rect', size: [10, 10] }, fill: '#000000' }), ...(l.hidden ? { hidden: true } : {}), transform: tr(l) };
    });
    precomps[s.id] = { version: '1.8.0', id: s.id, width: 1920, height: 1080, fps: 30, durationInFrames: frames, assets: Object.fromEntries(layers.filter((l) => l.assetId).map((l) => [l.assetId, assets[l.assetId!]])), layers };
    root.push({ kind: 'precomp', id: s.id, inPoint: start, outPoint: start + frames, compId: s.id, width: 1920, height: 1080, transform: tr({ id: s.id, role: 'x', position: [0, 0] }) });
    metaScenes[s.id] = { precompId: s.id, startFrame: start, durationFrames: frames, mode: s.mode ?? 'motion', ...(s.intent ? { intent: s.intent } : {}) };
    start += frames;
  }
  return { version: '1.8.0', id: 'film', width: 1920, height: 1080, fps: 30, durationInFrames: Math.max(1, start), assets, layers: root, precomps, meta: { director: { scenes: metaScenes, layers: metaLayers } } } as unknown as AepCompositionJson;
}
