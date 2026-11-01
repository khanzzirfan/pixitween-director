import { useEffect, useState } from 'react';
import type { FilmEvent } from '@shared/events';

/** Subscribe to a film's event stream. Duplicates (same seq) are dropped; the stream closes on unmount or id change. */
export function useFilmEvents(filmId: string | null): FilmEvent[] {
  const [events, setEvents] = useState<FilmEvent[]>([]);

  useEffect(() => {
    setEvents([]);
    if (!filmId) return;
    const seen = new Set<string>();
    const source = new EventSource(`/api/films/${filmId}/events`);
    source.addEventListener('film', (ev) => {
      const msg = ev as MessageEvent<string>;
      if (msg.lastEventId) {
        if (seen.has(msg.lastEventId)) return;
        seen.add(msg.lastEventId);
      }
      try {
        const event = JSON.parse(msg.data) as FilmEvent;
        setEvents((prev) => [...prev, event]);
      } catch {
        // ignore a malformed frame
      }
    });
    return () => source.close();
  }, [filmId]);

  return events;
}
