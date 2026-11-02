// The motion check: is a film a film, or a handful of still frames that blink? It looks at rendered pictures, not at the plan: the film is
// sampled at a fixed step, and the share of the picture that changed between neighbouring samples says how much moved. A shot whose pictures
// barely change is static. Pure: it takes pixels and times; the script that renders the frames is scripts/motion-check.ts.

/** A picture in grey, one byte a pixel. */
export interface Gray {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray;
}

/** Two pictures are said to differ at a pixel when it changed by more than this much (of 255): above the noise of the lens blur and the film grain. */
export const CHANGE_LEVEL = 10;

/**
 * The share of the picture that changed between two pictures of one size, 0 to 1. This is the motion measure: a small bright product moving
 * across a pale beach changes few pixels by a lot, and the mean change would hide it, while the share of changed pixels says how much of the
 * picture moved.
 */
export function changedShare(a: Gray, b: Gray, level = CHANGE_LEVEL): number {
  if (a.width !== b.width || a.height !== b.height) throw new RangeError('the two pictures differ in size');
  let n = 0;
  for (let i = 0; i < a.data.length; i++) if (Math.abs(a.data[i]! - b.data[i]!) > level) n++;
  return a.data.length ? n / a.data.length : 0;
}

/** The numbers a judge holds a film to. A step is the change between two pictures `stepSec` apart. */
export interface MotionRules {
  /** The sampling step, in seconds. */
  stepSec: number;
  /** A moving shot's median step must change at least this share of the picture (0.01 is one percent). */
  minShot: number;
  /** The last shot is the price hold and may be calmer: it must still change at least this much. */
  minHold: number;
  /** At least this share of all steps must change at least `minHold`: a film is not mostly frozen. */
  minLive: number;
}

/** One shot's motion: its window, and how its steps changed. */
export interface ShotMotion {
  shot: number;
  start: number;
  end: number;
  steps: number;
  median: number;
  mean: number;
  peak: number;
}

const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/**
 * Gives every step to the shot that holds its middle, and reads each shot's motion. `times` are the sample times in seconds; `diffs[k]` is the
 * change between sample k and sample k + 1. A step that crosses a cut belongs to the shot it ends in: a cut is a change of place, not motion,
 * so it is left out (its middle may lie in either shot, and a cut must not pass for a camera move).
 */
export function shotMotion(times: number[], diffs: number[], shots: Array<{ start: number; end: number }>): ShotMotion[] {
  return shots.map((s, n) => {
    const own: number[] = [];
    for (let k = 0; k < diffs.length; k++) {
      const t0 = times[k]!;
      const t1 = times[k + 1]!;
      // the whole step lies in this shot, so no cut is inside it
      if (t0 >= s.start - 1e-6 && t1 <= s.end + 1e-6) own.push(diffs[k]!);
    }
    const mean = own.length ? own.reduce((a, b) => a + b, 0) / own.length : 0;
    return { shot: n, start: s.start, end: s.end, steps: own.length, median: median(own), mean, peak: own.length ? Math.max(...own) : 0 };
  });
}

export interface MotionVerdict {
  ok: boolean;
  /** Sentences a person can act on; empty when ok. */
  problems: string[];
  /** The share of steps (cuts left out) that changed at least `minHold`. */
  live: number;
}

/** Holds a film's measured shots to the rules: no moving shot frozen, the hold alive, the film not mostly still. */
export function judgeMotion(shots: ShotMotion[], rules: MotionRules): MotionVerdict {
  const problems: string[] = [];
  shots.forEach((s, n) => {
    if (s.steps === 0) return; // too short to measure
    const last = n === shots.length - 1;
    const floor = last ? rules.minHold : rules.minShot;
    if (s.median < floor) problems.push(`shot ${n + 1} (${s.start.toFixed(1)}-${s.end.toFixed(1)} s) is static: the picture changes ${(s.median * 100).toFixed(2)}% a step, it needs ${(floor * 100).toFixed(2)}%`);
  });
  const all = shots.reduce((a, s) => a + s.steps, 0);
  // nothing measured is not a pass: there was no film, or every shot was too short to sample
  if (!all) problems.push('nothing could be measured: the film has no shots long enough to sample');
  const live = all ? shots.reduce((a, s) => a + s.steps * (s.median >= rules.minHold ? 1 : 0), 0) / all : 0;
  if (all && live < rules.minLive) problems.push(`only ${Math.round(live * 100)}% of the film moves; at least ${Math.round(rules.minLive * 100)}% must`);
  return { ok: problems.length === 0, problems, live };
}
