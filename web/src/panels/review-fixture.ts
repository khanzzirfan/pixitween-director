import type { FilmEvent } from '@shared/events';

/** Built-in review events for the Review panel: one Rule finding, one Spark finding and one fix with before and after frames. */
export function reviewFixtureEvents(o: { status?: 'reviewing' | 'ready'; geometryError?: number } = {}): FilmEvent[] {
  const filmId = 'film_000000000001' as const;
  const at = new Date(0).toISOString();
  const base = { filmId, at };
  const events: FilmEvent[] = [
    { ...base, type: 'film.status', status: 'reviewing' },
    {
      ...base,
      type: 'review.finding',
      sceneId: 's1',
      kind: 'text-over-product',
      deterministic: true,
      atSec: 0.8,
      evidence: "headline 's1:headline' covers 22.0% of the product at 0.80 s",
    },
    {
      ...base,
      type: 'review.finding',
      sceneId: 's1',
      kind: 'low-contrast',
      deterministic: false,
      atSec: 0.8,
      evidence: 'white caption lettering washes out over the bright cup',
    },
    { ...base, type: 'review.fix', sceneId: 's1', atSec: 0.8, beforeFrame: 'ast_before', note: 'setTransform s1:caption' },
    {
      ...base,
      type: 'review.fix',
      sceneId: 's1',
      atSec: 0.8,
      beforeFrame: 'ast_before',
      afterFrame: 'ast_after',
      note: 'setTransform s1:caption',
    },
    { ...base, type: 'film.status', status: 'ready' },
  ];
  if (o.status === 'reviewing') events.push({ ...base, type: 'film.status', status: 'reviewing' });
  return events;
}

/** Built-in events with no findings at all: used to check the "No issues found" line. */
export function cleanReviewEvents(): FilmEvent[] {
  const base = { filmId: 'film_000000000001' as const, at: new Date(0).toISOString() };
  return [
    { ...base, type: 'film.status', status: 'reviewing' },
    { ...base, type: 'film.status', status: 'ready' },
  ];
}
