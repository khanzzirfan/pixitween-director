// Owned by S12e. Turns a log's timestamps into a playback schedule: real rhythm, dead time squeezed, one speed knob.
import type { FilmEvent } from '@shared/events';

export const SPEEDS = [1, 2, 4, 8] as const;
export type Speed = (typeof SPEEDS)[number];
/** A pause longer than this is shortened to it before the speed applies, so a 2-minute build stays watchable. */
export const MAX_GAP_MS = 2000;

export interface Scheduled {
  /** Index into the original event list. */
  index: number;
  /** Milliseconds from the start of the replay at the chosen speed. */
  atMs: number;
  event: FilmEvent;
}

/** Events keep their log order. Gaps between consecutive events are capped at `maxGapMs` (default 2 s; pass Infinity to keep real time), then divided by `speed`. */
export function schedule(events: readonly FilmEvent[], speed: number = 1, maxGapMs: number = MAX_GAP_MS): Scheduled[] {
  const out: Scheduled[] = [];
  let clock = 0;
  let prev: number | undefined;
  events.forEach((event, index) => {
    const t = Date.parse(event.at);
    if (prev !== undefined && Number.isFinite(t)) clock += Math.min(Math.max(t - prev, 0), maxGapMs);
    if (Number.isFinite(t)) prev = Math.max(t, prev ?? t);
    out.push({ index, atMs: clock / speed, event });
  });
  return out;
}

/** How many scheduled events have happened by `ms`. */
export function countAt(sched: readonly Scheduled[], ms: number): number {
  let n = 0;
  while (n < sched.length && sched[n]!.atMs <= ms) n++;
  return n;
}

export const totalMs = (sched: readonly Scheduled[]): number => sched[sched.length - 1]?.atMs ?? 0;
