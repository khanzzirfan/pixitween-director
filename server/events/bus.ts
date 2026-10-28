import { filmEventSchema, type EventEnvelope, type FilmEvent } from '@shared/events';
import { loadEnv } from '../env';
import { appendEvent, readEvents } from './log';

export interface EventBus {
  emit(filmId: string, event: FilmEvent): Promise<number>;
  subscribe(filmId: string, fn: (env: EventEnvelope) => void): () => void;
  replay(filmId: string, afterSeq?: number): Promise<EventEnvelope[]>;
}

export function createEventBus(dir: string): EventBus {
  const subs = new Map<string, Set<(env: EventEnvelope) => void>>();
  return {
    async emit(filmId, event) {
      const parsed = filmEventSchema.parse(event);
      const seq = await appendEvent(dir, filmId, parsed);
      for (const fn of [...(subs.get(filmId) ?? [])]) {
        try {
          fn({ seq, event: parsed });
        } catch (e) {
          console.error('event subscriber threw', e);
        }
      }
      return seq;
    },
    subscribe(filmId, fn) {
      let set = subs.get(filmId);
      if (!set) subs.set(filmId, (set = new Set()));
      set.add(fn);
      return () => {
        set.delete(fn);
        if (set.size === 0) subs.delete(filmId);
      };
    },
    replay: (filmId, afterSeq = 0) => readEvents(dir, filmId, afterSeq),
  };
}

let shared: EventBus | undefined;
const bus = () => (shared ??= createEventBus(loadEnv().DATA_DIR));

export const emit: EventBus['emit'] = (filmId, event) => bus().emit(filmId, event);
export const subscribe: EventBus['subscribe'] = (filmId, fn) => bus().subscribe(filmId, fn);
