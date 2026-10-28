// Owned by S8a. Renders the audio plan into one stereo buffer.
import type { AudioPlanItem } from './audioPlan';

export interface MixDeps {
  createOfflineContext(channels: number, length: number, sampleRate: number): OfflineAudioContext;
  loadBuffer(src: string, ctx: BaseAudioContext): Promise<AudioBuffer>;
}

const SAMPLE_RATE = 44100;

const defaultDeps: MixDeps = {
  createOfflineContext: (channels, length, sampleRate) => new OfflineAudioContext(channels, length, sampleRate),
  async loadBuffer(src, ctx) {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`could not load ${src} (${res.status})`);
    return ctx.decodeAudioData(await res.arrayBuffer());
  },
};

export async function mixAudio(
  plan: AudioPlanItem[],
  durationSec: number,
  deps: MixDeps = defaultDeps,
): Promise<{ buffer: AudioBuffer | null; warnings: Array<{ layerId: string; reason: string }> }> {
  if (plan.length === 0) return { buffer: null, warnings: [] };
  const ctx = deps.createOfflineContext(2, Math.ceil(durationSec * SAMPLE_RATE), SAMPLE_RATE);
  const warnings: Array<{ layerId: string; reason: string }> = [];
  let mixed = 0;

  for (const item of plan) {
    let buffer: AudioBuffer;
    try {
      buffer = await deps.loadBuffer(item.src, ctx);
    } catch (e) {
      warnings.push({ layerId: item.layerId, reason: e instanceof Error ? e.message : String(e) });
      continue;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    item.gain.forEach(([t, v], i) => {
      const at = item.startSec + t;
      if (i === 0 || t === item.gain[i - 1]![0]) gain.gain.setValueAtTime(v, at);
      else gain.gain.linearRampToValueAtTime(v, at);
    });
    source.connect(gain);
    if (typeof item.pan === 'number') {
      const panner = ctx.createStereoPanner();
      panner.pan.value = item.pan;
      gain.connect(panner);
      panner.connect(ctx.destination);
    } else {
      gain.connect(ctx.destination);
    }
    source.start(item.startSec);
    source.stop(item.endSec);
    mixed++;
  }

  if (mixed === 0) return { buffer: null, warnings };
  return { buffer: await ctx.startRendering(), warnings };
}
