import type { FilmEvent } from '@shared/events';

export interface BadgeInfo {
  backend: 'spark' | 'glimmer' | 'spark-open' | 'wonder';
  seconds: number;
  local: boolean;
  fallbackFrom?: { status?: number };
  text: string;
}

const NAMES = { glimmer: 'Muse Glimmer (local)', spark: 'Muse Spark', 'spark-open': 'Muse Spark Open', wonder: 'Muse Wonder' } as const;

/** Which model made the last edit, how long it took, and whether the Meta API had to be skipped to get there. */
export function formatBadge(events: FilmEvent[]): BadgeInfo | null {
  let last = -1;
  let before = -1;
  events.forEach((e, i) => {
    if (e.type !== 'agent.turn') return;
    before = last;
    last = i;
  });
  if (last === -1) return null;
  const turn = events[last] as Extract<FilmEvent, { type: 'agent.turn' }>;
  const seconds = Math.round(turn.ms / 1000);

  const fallback = events.slice(before + 1, last).find((e): e is Extract<FilmEvent, { type: 'error' }> => e.type === 'error' && e.where === 'llm.fallback');
  if (fallback) {
    const status = fallback.status ?? (/\b(\d{3})\b/.exec(fallback.message)?.[1] ? Number(/\b(\d{3})\b/.exec(fallback.message)![1]) : undefined);
    return {
      backend: turn.backend,
      seconds,
      local: turn.backend === 'glimmer',
      fallbackFrom: { status },
      text: `Meta API unavailable${status !== undefined ? ` (${status})` : ''}: used ${NAMES[turn.backend]} · ${seconds} s`,
    };
  }
  return { backend: turn.backend, seconds, local: turn.backend === 'glimmer', text: `edited by ${NAMES[turn.backend]} · ${seconds} s` };
}
