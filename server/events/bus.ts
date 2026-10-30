import { filmEventSchema, type EventEnvelope, type FilmEvent } from '@shared/events';
import { loadEnv } from '../env';
import { appendEvent, readEvents } from './log';

export interface EventBus {
  emit(filmId: string, event: FilmEvent): Promise<number>;
  /** `internal` subscribers (the crew's own history, metrics) do not count as a browser watching the film. */
  subscribe(filmId: string, fn: (env: EventEnvelope) => void, opts?: { internal?: boolean }): () => void;
  /** Public subscribers only: the browser tabs streaming this film. */
  subscriberCount(filmId: string): number;
  replay(filmId: string, afterSeq?: number): Promise<EventEnvelope[]>;
}

export function createEventBus(dir: string): EventBus {
  const subs = new Map<string, Set<{ fn: (env: EventEnvelope) => void; internal: boolean }>>();
  return {
    async emit(filmId, event) {
      const parsed = filmEventSchema.parse(event);
      const seq = await appendEvent(dir, filmId, parsed);
      for (const sub of [...(subs.get(filmId) ?? [])]) {
        try {
          sub.fn({ seq, event: parsed });
        } catch (e) {
          console.error('event subscriber threw', e);
        }
      }
      return seq;
    },
    subscribe(filmId, fn, opts) {
      let set = subs.get(filmId);
      if (!set) subs.set(filmId, (set = new Set()));
      const entry = { fn, internal: opts?.internal ?? false };
      set.add(entry);
      return () => {
        set.delete(entry);
        if (set.size === 0) subs.delete(filmId);
      };
    },
    subscriberCount: (filmId) => [...(subs.get(filmId) ?? [])].filter((s) => !s.internal).length,
    replay: (filmId, afterSeq = 0) => readEvents(dir, filmId, afterSeq),
  };
}

let shared: EventBus | undefined;
const bus = () => (shared ??= createEventBus(loadEnv().DATA_DIR));

export const emit: EventBus['emit'] = (filmId, event) => bus().emit(filmId, event);
export const subscribe: EventBus['subscribe'] = (filmId, fn) => bus().subscribe(filmId, fn);
