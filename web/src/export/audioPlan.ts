// Owned by S8a. Every audio source in a composition with its absolute start and end, ready for the mixer.
import type { AepCompositionJson } from 'reacthub-pixitweenjs';
import { levelToGainPoints, type GainPoint } from './gainCurve';

export interface AudioPlanItem {
  layerId: string;
  assetId: string;
  src: string;
  source: 'audio' | 'video';
  startSec: number;
  endSec: number;
  gain: GainPoint[];
  pan?: number;
}

type Obj = Record<string, any>;
const firstValue = (f: unknown): number | undefined => (typeof f === 'number' ? f : Array.isArray(f) && typeof (f[0] as Obj)?.v === 'number' ? (f[0] as Obj).v : undefined);

export function collectAudioPlan(comp: AepCompositionJson): AudioPlanItem[] {
  const items: AudioPlanItem[] = [];

  const walk = (c: AepCompositionJson, offsetSec: number, outerAssets: Record<string, any>): void => {
    const assets = { ...outerAssets, ...(c.assets as Record<string, any>) }; // inner assets override outer, like the engine
    for (const layer of c.layers as Obj[]) {
      if (layer.kind === 'precomp') {
        const inner = (c.precomps as Record<string, AepCompositionJson> | undefined)?.[layer.compId] ?? (comp.precomps as Record<string, AepCompositionJson> | undefined)?.[layer.compId];
        if (inner) walk(inner, offsetSec + layer.inPoint / c.fps, assets);
        continue;
      }
      if (layer.kind !== 'audio' && layer.kind !== 'video') continue;
      if (layer.hidden || (layer.kind === 'video' && layer.muted === true)) continue;
      const asset = assets[layer.assetId];
      if (!asset || !asset.src) continue;
      const pan = layer.kind === 'audio' ? firstValue(layer.pan) : undefined;
      items.push({
        layerId: layer.id,
        assetId: layer.assetId,
        src: asset.src,
        source: layer.kind,
        startSec: offsetSec + layer.inPoint / c.fps,
        endSec: offsetSec + layer.outPoint / c.fps,
        gain: layer.kind === 'audio' ? levelToGainPoints(layer.level, c.fps, layer.inPoint) : [[0, 1]],
        ...(pan !== undefined ? { pan } : {}),
      });
    }
  };

  walk(comp, 0, {});
  return items.map((it, i) => ({ it, i })).sort((a, b) => a.it.startSec - b.it.startSec || a.i - b.i).map((x) => x.it);
}
