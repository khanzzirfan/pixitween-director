// Owned by Catalog Crew C1 (US-009). The one hook the catalog wall reads: it loads a run and keeps
// its rows current from the carrier film's own event stream, so every catalog view shows the same
// state without polling and without a second copy of the truth.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { summarize, type CatalogRow, type CatalogRun, type CatalogSummary } from '@shared/catalog-run';
import type { FilmEvent } from '@shared/events';
import { useFilmEvents } from '../api/sse';
import { getCatalog } from './api';

export interface CatalogState {
  /** The run as the server has it, with the rows the events have replaced. */
  run: CatalogRun | null;
  /** The run's rows, in the run's order. */
  rows: CatalogRow[];
  /** How many rows are done and how each one ended. */
  summary: CatalogSummary;
  /** Why the run could not be read, when it could not be read. */
  error: unknown;
  /** Reads the run again from the server. */
  reload: () => void;
  /** Replaces a row right away, e.g. with the answer to a price edit. */
  applyRow: (row: CatalogRow) => void;
}

/**
 * What the events do to the run: a row replaces the row with the same product, and the run is done
 * when the run says so. An event that belongs to another run is left alone.
 */
function applyEvents(run: CatalogRun, events: FilmEvent[], catalogId: string | null | undefined): CatalogRun {
  let next = run;
  for (const event of events) {
    if (event.type !== 'catalog.row' && event.type !== 'catalog.done') continue;
    if (event.catalogId !== catalogId) continue;
    if (event.type === 'catalog.row') {
      next = { ...next, rows: next.rows.map((r) => (r.product.id === event.row.product.id ? event.row : r)) };
    } else {
      next = { ...next, state: 'done', costUsd: event.costUsd };
    }
  }
  return next;
}

/**
 * A catalog run, live: the rows as they are now.
 *
 * The run is read once and then kept current by the carrier film's event stream, which is where the
 * runner tells the wall about every row. A row event replaces the row with the same product id, so
 * the wall's order never changes and a row that is not mentioned keeps its state.
 */
export function useCatalog(catalogId: string | null | undefined): CatalogState {
  const [run, setRun] = useState<CatalogRun | null>(null);
  const [error, setError] = useState<unknown>(null);
  const latest = useRef(0); // request counter: a slow answer from an older id is dropped
  const handled = useRef(0); // how many events have been applied already

  const load = useCallback(() => {
    if (!catalogId) return;
    const n = ++latest.current;
    getCatalog(catalogId).then(
      (r) => n === latest.current && (setRun(r), setError(null)),
      (e: unknown) => n === latest.current && setError(e),
    );
  }, [catalogId]);

  useEffect(() => {
    setRun(null);
    setError(null);
    handled.current = 0;
    latest.current++;
    load();
  }, [catalogId, load]);

  // The carrier film carries the run's events, so the wall watches that film and nothing else.
  const events = useFilmEvents(run?.filmId ?? null);

  useEffect(() => {
    // The events are not consumed until there is a run to hold them: an event that arrives before
    // the run is read is applied as soon as it is.
    if (!run) return;
    // The stream restarts when the film changes, and then the events we hold are not the ones we
    // have seen, so the count starts again.
    if (events.length < handled.current) handled.current = 0;
    const fresh = events.slice(handled.current);
    if (!fresh.length) return;
    handled.current = events.length;
    setRun((prev) => (prev ? applyEvents(prev, fresh, catalogId) : prev));
  }, [events, run, catalogId]);

  const rows = useMemo(() => run?.rows ?? [], [run]);
  const summary = useMemo(() => summarize(rows), [rows]);

  const applyRow = useCallback((row: CatalogRow) => {
    setRun((prev) => (prev ? { ...prev, rows: prev.rows.map((r) => (r.product.id === row.product.id ? row : r)) } : prev));
  }, []);

  return { run, rows, summary, error, reload: load, applyRow };
}
