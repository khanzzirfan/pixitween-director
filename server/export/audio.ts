// The sound of an export. Reads the audio layers of a composition (the same rules as the browser's audio plan: precomp offsets, level keyframes,
// pan), mixes them with ffmpeg and puts the result under the finished video, which is copied as it is.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runFfmpeg } from '../media/ffmpeg';

export type GainPoint = [timeSec: number, value: number];
export interface AudioItem {
  layerId: string;
  assetId: string;
  startSec: number;
  endSec: number;
  gain: GainPoint[];
  pan?: number;
}

type Obj = Record<string, any>;
type Kf = { t: number; v: number; hold?: boolean };

const ASSET_RE = /\/api\/assets\/(ast_[0-9a-f]+)/;
const firstValue = (f: unknown): number | undefined => (typeof f === 'number' ? f : Array.isArray(f) && typeof (f[0] as Obj)?.v === 'number' ? (f[0] as Obj).v : undefined);

/** Level (a number or keyframes in frames) as gain points in seconds from the layer's own start. */
export function levelToGain(level: unknown, fps: number, inPoint: number): GainPoint[] {
  if (level === undefined) return [[0, 1]];
  if (typeof level === 'number') return [[0, Math.max(0, level)]];
  const kfs = level as Kf[];
  if (!Array.isArray(kfs) || kfs.length === 0) return [[0, 1]];
  const pts = kfs.map((k) => ({ time: (k.t - inPoint) / fps, v: Math.max(0, k.v), hold: !!k.hold }));
  const first = pts.findIndex((p) => p.time >= 0);
  if (first === -1) return [[0, pts[pts.length - 1]!.v]];
  const out: GainPoint[] = [];
  if (pts[first]!.time > 0 && first > 0) {
    const a = pts[first - 1]!;
    const b = pts[first]!;
    out.push([0, a.hold ? a.v : a.v + ((b.v - a.v) * (0 - a.time)) / (b.time - a.time)]);
    if (a.hold) out.push([b.time, a.v]);
  }
  for (let i = first; i < pts.length; i++) {
    const a = pts[i]!;
    out.push([a.time, a.v]);
    const next = pts[i + 1];
    if (a.hold && next) out.push([next.time, a.v]);
  }
  return out;
}

/** Every audio layer with its absolute start and end, earliest first. Layers whose asset is not a stored asset are left out. */
export function collectAudio(comp: Obj): AudioItem[] {
  const items: AudioItem[] = [];
  const walk = (c: Obj, offsetSec: number, outer: Obj): void => {
    const assets = { ...outer, ...(c.assets ?? {}) };
    for (const layer of (c.layers ?? []) as Obj[]) {
      if (layer.kind === 'precomp') {
        const inner = c.precomps?.[layer.compId] ?? comp.precomps?.[layer.compId];
        if (inner) walk(inner, offsetSec + layer.inPoint / c.fps, assets);
        continue;
      }
      if (layer.kind !== 'audio' || layer.hidden) continue;
      const id = ASSET_RE.exec(assets[layer.assetId]?.src ?? '')?.[1];
      if (!id) continue;
      const pan = firstValue(layer.pan);
      items.push({
        layerId: layer.id,
        assetId: id,
        startSec: offsetSec + layer.inPoint / c.fps,
        endSec: offsetSec + layer.outPoint / c.fps,
        gain: levelToGain(layer.level, c.fps, layer.inPoint),
        ...(pan !== undefined ? { pan } : {}),
      });
    }
  };
  walk(comp, 0, {});
  return items.map((it, i) => ({ it, i })).sort((a, b) => a.it.startSec - b.it.startSec || a.i - b.i).map((x) => x.it);
}

const n = (x: number) => Number(x.toFixed(4)).toString();

/** An ffmpeg `volume` expression that follows the gain points linearly, in the clip's own time `t`. */
export function gainExpr(points: GainPoint[]): string {
  if (points.length === 1) return n(points[0]![1]);
  let expr = n(points[points.length - 1]![1]);
  for (let i = points.length - 2; i >= 0; i--) {
    const [t0, v0] = points[i]!;
    const [t1, v1] = points[i + 1]!;
    const seg = t1 === t0 ? n(v1) : `${n(v0)}+(${n(v1 - v0)})*(t-${n(t0)})/${n(t1 - t0)}`;
    expr = `if(lt(t,${n(t1)}),${seg},${expr})`;
  }
  return `if(lt(t,${n(points[0]![0])}),${n(points[0]![1])},${expr})`;
}

/** Arguments that lay the items under `video` for `durationSec`, copying the picture and encoding the mix as AAC. */
export function buildMuxArgs(o: { video: string; files: string[]; items: AudioItem[]; durationSec: number; out: string }): string[] {
  const parts = o.items.map((it, i) => {
    const len = Math.max(0.01, Math.min(it.endSec, o.durationSec) - it.startSec);
    const delay = Math.round(it.startSec * 1000);
    const chain = [
      `[${i + 1}:a]aformat=sample_rates=44100:channel_layouts=stereo`,
      `atrim=0:${n(len)}`,
      'asetpts=PTS-STARTPTS',
      `volume='${gainExpr(it.gain)}':eval=frame`,
    ];
    if (typeof it.pan === 'number') {
      const a = ((Math.max(-1, Math.min(1, it.pan)) + 1) * Math.PI) / 4;
      chain.push(`pan=stereo|c0=${n(Math.cos(a))}*c0|c1=${n(Math.sin(a))}*c1`);
    }
    chain.push(`adelay=${delay}|${delay}[a${i}]`);
    return chain.join(',');
  });
  const labels = o.items.map((_, i) => `[a${i}]`).join('');
  const mix = `${labels}amix=inputs=${o.items.length}:normalize=0:dropout_transition=0,apad=whole_dur=${n(o.durationSec)},atrim=0:${n(o.durationSec)},alimiter=limit=0.97[aout]`;
  return [
    '-y', '-i', o.video, ...o.files.flatMap((f) => ['-i', f]),
    '-filter_complex', [...parts, mix].join(';'),
    '-map', '0:v', '-map', '[aout]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-t', n(o.durationSec), '-movflags', '+faststart', o.out,
  ];
}

export interface MuxInput {
  dir: string;
  video: string;
  out: string;
  durationSec: number;
  items: AudioItem[];
  read(assetId: string): Promise<Buffer>;
}

/** Returns the layers that could not be read, so the page can say the export is missing them. */
export async function muxAudio(i: MuxInput, run: typeof runFfmpeg = runFfmpeg): Promise<{ skipped: string[] }> {
  const dir = join(i.dir, 'audio');
  await mkdir(dir, { recursive: true });
  const usable: AudioItem[] = [];
  const files: string[] = [];
  const skipped: string[] = [];
  for (const it of i.items) {
    try {
      const file = join(dir, `${usable.length}.bin`);
      await writeFile(file, await i.read(it.assetId));
      usable.push(it);
      files.push(file);
    } catch {
      skipped.push(it.layerId);
    }
  }
  if (usable.length === 0) throw new Error('no audio could be read');
  await run(buildMuxArgs({ video: i.video, files, items: usable, durationSec: i.durationSec, out: i.out }), { timeoutMs: 300000 });
  return { skipped };
}
