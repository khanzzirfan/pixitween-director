// One entry point: AEP composition -> valid MotionDoc. See engine/docs/10-aep-adapter.md.
// Unsupported fields/layer kinds become warnings; it throws only when its own output
// fails parseMotionDoc / validateTargets (a converter bug, not a film problem).
import type { AepCompositionJson } from '@shared/aep/composition';
import { parseMotionDoc, type MotionDoc } from '@engine/schema';
import { validateTargets } from '@engine/timeline';
import { convertAssets } from './assets';
import { convertLayers } from './scene';
import type { AudioCue } from './audio';

export type { AudioCue } from './audio';

export interface AepToMotionResult {
  doc: MotionDoc;
  warnings: string[];
  audio: AudioCue[];
}

export function aepToMotion(comp: AepCompositionJson, opts: { resolveUrl?(src: string): string } = {}): AepToMotionResult {
  const { assets } = convertAssets(comp.assets, opts.resolveUrl);
  // Precomp layers become groups in the same flat doc, so their asset tables must live in it too.
  const seen = new Set<AepCompositionJson>();
  const collect = (precomps: AepCompositionJson['precomps']) => {
    for (const nested of Object.values(precomps ?? {})) {
      if (seen.has(nested)) continue;
      seen.add(nested);
      for (const [id, asset] of Object.entries(convertAssets(nested.assets, opts.resolveUrl).assets)) assets[id] ??= asset;
      collect(nested.precomps);
    }
  };
  collect(comp.precomps);
  const converted = convertLayers(comp.layers, comp.assets, comp.precomps, comp.fps, comp.theme, {
    ...opts,
    compSize: { width: comp.width, height: comp.height },
  });
  const { warnings, audio } = converted;
  let { layers } = converted;
  if (layers.length === 0) {
    // MotionDoc requires >= 1 layer; keep an invisible placeholder so audio-only/unsupported comps still load.
    warnings.push('comp has no convertible layers; added an empty placeholder layer');
    layers = [
      {
        id: 'empty',
        type: 'shape',
        start: 0,
        anchor: [0.5, 0.5],
        effects: [],
        tweens: [],
        shape: 'rect',
        width: 1,
        height: 1,
        fill: '#000000',
        radius: 0,
        alpha: 0,
      } as unknown as (typeof converted.layers)[number],
    ];
  }

  const input = {
    version: 1,
    width: comp.width,
    height: comp.height,
    fps: comp.fps,
    duration: comp.durationInFrames / comp.fps,
    background: comp.bgColor ?? 'transparent',
    assets,
    layers,
  };

  const parsed = parseMotionDoc(input);
  if (!parsed.ok) {
    throw new Error(`aepToMotion produced an invalid MotionDoc: ${parsed.errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`);
  }
  const targetErrors = validateTargets(parsed.doc);
  if (targetErrors.length > 0) {
    throw new Error(`aepToMotion produced bad tween targets: ${targetErrors.map((e) => `${e.path}: ${e.message}`).join('; ')}`);
  }
  return { doc: parsed.doc, warnings, audio };
}
