// The line-up client: start one from a feed, read it, and keep it current while its films are made one by one.
import { useCallback, useEffect, useState } from 'react';
import { currentItem, type Lineup } from '@shared/lineup';
import { request } from '../api/client';

export interface LineupStarted {
  lineupId: string;
  filmIds: string[];
}

export const createLineup = (form: FormData) => request<LineupStarted>('POST', '/api/lineups', form);
export const getLineup = (id: string) => request<Lineup>('GET', `/api/lineups/${encodeURIComponent(id)}`);
export const stopLineup = (id: string) => request<{ ok: boolean; stopped: boolean }>('POST', `/api/lineups/${encodeURIComponent(id)}/stop`);

const finished = (l: Lineup) => l.items.every((i) => i.state === 'done' || i.state === 'failed' || i.state === 'stopped');

/** The line-up as the server has it, read again every few seconds until every film has ended. */
export function useLineup(id: string | null | undefined, everyMs = 3000): { lineup: Lineup | null; reload: () => void } {
  const [lineup, setLineup] = useState<Lineup | null>(null);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  useEffect(() => {
    if (!id) return setLineup(null);
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = async () => {
      try {
        const next = await getLineup(id);
        if (!live) return;
        setLineup(next);
        if (!finished(next)) timer = setTimeout(read, everyMs);
      } catch {
        if (live) timer = setTimeout(read, everyMs * 2);
      }
    };
    void read();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [id, everyMs, tick]);
  return { lineup, reload };
}

/** The product whose film the studio should follow: the one being made now. */
export const followedFilm = (l: Lineup | null): string | undefined => (l ? currentItem(l)?.filmId : undefined);
