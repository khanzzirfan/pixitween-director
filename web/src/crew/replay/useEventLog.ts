// Owned by S12e. A film's whole event log in one request, for a replay. It reads /log only: no mutating route, no model call.
import { useEffect, useState } from 'react';
import type { FilmEvent } from '@shared/events';
import { ApiRequestError, request } from '../../api/client';

export type LogError = 'not_found' | 'failed';
export interface EventLog {
  events: FilmEvent[];
  loading: boolean;
  error?: LogError;
}

export function useEventLog(filmId: string | null | undefined): EventLog {
  const [state, setState] = useState<EventLog>({ events: [], loading: !!filmId });
  useEffect(() => {
    if (!filmId) {
      setState({ events: [], loading: false });
      return;
    }
    let live = true;
    setState({ events: [], loading: true });
    request<FilmEvent[]>('GET', `/api/films/${filmId}/log`).then(
      (events) => live && setState({ events, loading: false }),
      (e: unknown) => live && setState({ events: [], loading: false, error: e instanceof ApiRequestError && e.status === 404 ? 'not_found' : 'failed' }),
    );
    return () => {
      live = false;
    };
  }, [filmId]);
  return state;
}
