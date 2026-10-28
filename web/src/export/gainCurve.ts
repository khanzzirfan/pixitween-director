// Owned by S8a. Audio level keyframes -> gain points the export mixer can automate.
export type GainPoint = [timeSec: number, value: number];
type Kf = { t: number; v: number; hold?: boolean };

export function levelToGainPoints(level: number | undefined | Kf[], fps: number, layerInPointFrames: number): GainPoint[] {
  if (level === undefined) return [[0, 1]];
  if (typeof level === 'number') return [[0, Math.max(0, level)]];
  if (level.length === 0) return [[0, 1]];

  const pts = level.map((k) => ({ time: (k.t - layerInPointFrames) / fps, v: Math.max(0, k.v), hold: !!k.hold }));
  const firstVisible = pts.findIndex((p) => p.time >= 0);
  if (firstVisible === -1) return [[0, pts[pts.length - 1]!.v]];

  const out: GainPoint[] = [];
  const from = firstVisible;
  if (pts[firstVisible]!.time > 0 && firstVisible > 0) {
    // the first keyframe at or after 0 s is preceded by one before 0 s: start at the value at 0 s
    const a = pts[firstVisible - 1]!;
    const b = pts[firstVisible]!;
    const v = a.hold ? a.v : a.v + ((b.v - a.v) * (0 - a.time)) / (b.time - a.time);
    out.push([0, v]);
    if (a.hold) out.push([b.time, a.v]);
  }
  for (let i = from; i < pts.length; i++) {
    const a = pts[i]!;
    out.push([a.time, a.v]);
    const next = pts[i + 1];
    if (a.hold && next) out.push([next.time, a.v]); // an explicit step
  }
  return out;
}
