import { useCallback, useEffect, useRef, useState } from 'react';
import type { FilmState } from '@shared/composition';
import type { FilmEvent } from '@shared/events';
import { api } from './client';
import { useFilmEvents } from './sse';

export const REFETCH_DEBOUNCE_MS = 300;

/** Loads a film and re-fetches (debounced) when its status changes or a tool commits a new version. */
export function useFilm(filmId: string | null): { film: FilmState | null; events: FilmEvent[]; error: unknown } {
  const events = useFilmEvents(filmId);
  const [film, setFilm] = useState<FilmState | null>(null);
  const [error, setError] = useState<unknown>(null);
  const latest = useRef(0); // request counter: responses older than the newest request are dropped
  const handled = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const load = useCallback(() => {
    if (!filmId) return;
    const n = ++latest.current;
    api.getFilm(filmId).then(
      (f) => n === latest.current && (setFilm(f), setError(null)),
      (e: unknown) => n === latest.current && setError(e),
    );
  }, [filmId]);

  useEffect(() => {
    setFilm(null);
    setError(null);
    handled.current = 0;
    latest.current++;
    clearTimeout(timer.current);
    load();
    return () => clearTimeout(timer.current);
  }, [filmId, load]);

  useEffect(() => {
    const fresh = events.slice(handled.current);
    handled.current = events.length;
    // a crew job that finished, or a new storyboard revision, changes the film just as a tool call does
    const relevant = fresh.some((e) => e.type === 'film.status' || e.type === 'storyboard.revised' || (e.type === 'job.update' && e.job.status === 'done') || (e.type === 'tool.call' && e.ok && e.version !== undefined));
    if (!relevant) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(load, REFETCH_DEBOUNCE_MS);
  }, [events, load]);

  return { film, events, error };
}
