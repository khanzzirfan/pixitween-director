// AEP audio layer -> MotionDoc audio cue. See engine/docs/10-aep-adapter.md
// ("Layers", `audio` row): audio is never a layer, it becomes one `AudioCue` the
// player keeps in sync with the clock.
import type { AepLayer } from '@shared/aep/layer';
import type { AepAssetMap } from '@shared/aep/asset';
import { isKeyframed } from './keyframes';
import { sanitizeId } from './sanitizeId';

type AepAudioLayer = Extract<AepLayer, { kind: 'audio' }>;

export interface AudioCue {
  id: string;
  url: string;
  startSec: number;
  endSec: number;
  level: number;
}

export interface ConvertAudioResult {
  cue?: AudioCue;
  warnings: string[];
}

/** Rounds away floating-point drift from frame/fps division without changing the intended value. */
function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

export function convertAudio(
  layer: AepAudioLayer,
  assets: AepAssetMap,
  fps: number,
  resolveUrl: (src: string) => string = (src) => src,
): ConvertAudioResult {
  const asset = assets[layer.assetId];
  if (!asset) {
    return { warnings: [`layer ${layer.id}: audio asset '${layer.assetId}' not found`] };
  }

  const level = layer.level === undefined ? 1 : isKeyframed(layer.level) ? layer.level[0].v : layer.level;

  const cue: AudioCue = {
    id: sanitizeId(layer.id),
    url: resolveUrl(asset.src),
    startSec: round(layer.inPoint / fps),
    endSec: round(layer.outPoint / fps),
    level,
  };

  return { cue, warnings: [] };
}
