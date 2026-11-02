// Owned by S12e. Plays a film's event log back: the crew state is the fold of the events shown so far, and the picture is the composition of the newest version that existed by then.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FilmVersion } from '@shared/composition';
import type { FilmEvent } from '@shared/events';
import { foldCrew, type CrewState } from '../crewReducer';
import { countAt, schedule, totalMs, type Speed } from './replayClock';

export const TICK_MS = 50;
type Composition = FilmVersion['composition'];

export interface Replay {
  /** The events that have happened so far, in log order. */
  shown: FilmEvent[];
  crew: CrewState;
  /** The composition of the newest version made by the latest shown event (undefined before the first version). */
  composition: Composition | undefined;
  version: number | undefined;
  /** The film time of the latest shown event, for the elapsed counters. */
  nowMs: number | undefined;
  playing: boolean;
  done: boolean;
  speed: Speed;
  /** 0..1 of the events shown. */
  progress: number;
  /** Real milliseconds the whole replay takes at this speed. */
  durationMs: number;
  play(): void;
  pause(): void;
  restart(): void;
  seek(fraction: number): void;
  setSpeed(speed: Speed): void;
}

/** The newest version made at or before `at` (versions are in order). */
export function versionAt(versions: readonly FilmVersion[], at: string | undefined): FilmVersion | undefined {
  if (!at) return undefined;
  const t = Date.parse(at);
  let hit: FilmVersion | undefined;
  for (const v of versions) if (Date.parse(v.at) <= t) hit = v;
  return hit;
}

export function useReplay(events: readonly FilmEvent[], versions: readonly FilmVersion[], opts: { autoplay?: boolean; speed?: Speed } = {}): Replay {
  const [speed, setSpeedState] = useState<Speed>(opts.speed ?? 2);
  const sched = useMemo(() => schedule(events, speed), [events, speed]);
  const [count, setCount] = useState(0);
  const [playing, setPlaying] = useState(false);
  // where the clock was (in schedule milliseconds) when it last started, and the wall time then
  const anchor = useRef({ baseMs: 0, wall: 0 });
  const countRef = useRef(0);
  countRef.current = count;
  const total = events.length;

  const msOf = useCallback((n: number, s = sched) => (n > 0 ? s[n - 1]!.atMs : 0), [sched]);
  const start = useCallback((n: number, s = sched) => {
    anchor.current = { baseMs: msOf(n, s), wall: Date.now() };
  }, [msOf, sched]);

  // a different log starts over
  useEffect(() => {
    setCount(0);
    setPlaying(!!opts.autoplay && events.length > 0);
    anchor.current = { baseMs: 0, wall: Date.now() };
  }, [events]);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      const target = countAt(sched, anchor.current.baseMs + (Date.now() - anchor.current.wall));
      if (target !== countRef.current) setCount(target);
      if (target >= sched.length) setPlaying(false);
    }, TICK_MS);
    return () => clearInterval(id);
  }, [playing, sched]);

  const shown = useMemo(() => events.slice(0, count), [events, count]);
  const crew = useMemo(() => foldCrew(shown), [shown]);
  const last = shown[shown.length - 1];
  const made = versionAt(versions, last?.at);

  const done = total > 0 && count >= total;
  return {
    shown,
    crew,
    composition: made?.composition,
    version: made?.version,
    nowMs: last ? Date.parse(last.at) : undefined,
    playing,
    done,
    speed,
    progress: total ? count / total : 0,
    durationMs: totalMs(sched),
    play: () => {
      const from = done ? 0 : count;
      if (done) setCount(0);
      start(from);
      setPlaying(total > 0);
    },
    pause: () => setPlaying(false),
    restart: () => {
      setCount(0);
      start(0);
      setPlaying(total > 0);
    },
    seek: (fraction) => {
      const n = Math.max(0, Math.min(total, Math.round(fraction * total)));
      setCount(n);
      start(n);
    },
    setSpeed: (next) => {
      // keep the place: the same event count at the new speed
      const nextSched = schedule(events, next);
      setSpeedState(next);
      start(count, nextSched);
    },
  };
}
