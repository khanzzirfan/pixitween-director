// Owned by S12d. Crew state and crew actions in one hook, so the panels stay small.
import { useEffect, useMemo, useState } from 'react';
import type { FilmEvent } from '@shared/events';
import { actionsFor, type CrewActions } from './api';
import { foldCrew, type CrewState } from './crewReducer';

export function useCrew(filmId: string | null | undefined, events: readonly FilmEvent[]): { crew: CrewState; actions: CrewActions | null } {
  const crew = useMemo(() => foldCrew(events), [events]);
  const actions = useMemo(() => (filmId ? actionsFor(filmId) : null), [filmId]);
  return { crew, actions };
}

/** A clock that ticks once a second, for elapsed seconds and the 2 s "new" glow. `paused` freezes it (a replay brings its own time). */
export function useNow(intervalMs = 1000, paused = false): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, paused]);
  return now;
}
