import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CatalogRow, CatalogRun, RowStatus } from '@shared/catalog-run';
import type { FilmEvent } from '@shared/events';
import { useFilmEvents } from '../api/sse';
import type { CatalogError } from './api';
import { useCatalog } from './useCatalog';

vi.mock('../api/sse', () => ({ useFilmEvents: vi.fn() }));

const FILM = 'film_0123456789ab';
const CATALOG = 'cat_0123456789ab';

const product = (id: string) => ({ id, title: `Product ${id}`, price: 10, currency: 'USD', imageUrl: 'fixtures/can-product.png', category: 'cans' });

const row = (id: string, status: RowStatus = 'queued'): CatalogRow => ({ product: product(id), status, clipVersion: 0, check: null });

const RUN: CatalogRun = {
  id: CATALOG,
  filmId: FILM,
  aspect: '9:16',
  createdAt: '2026-11-01T10:00:00.000Z',
  state: 'running',
  costUsd: 0,
  rows: [row('can-original'), row('mug-stone'), row('mug-blue')],
};

const rowEvent = (catalogId: string, r: CatalogRow): FilmEvent => ({
  filmId: FILM,
  at: '2026-11-01T10:00:01.000Z',
  type: 'catalog.row',
  catalogId,
  row: r,
});

const fetchMock = vi.fn();
let stream: FilmEvent[] = [];

beforeEach(() => {
  stream = [];
  vi.mocked(useFilmEvents).mockImplementation(() => stream);
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => new Response(JSON.stringify(RUN), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

it('shows the rows of the run the server answered, and watches the carrier film', async () => {
  const { result } = renderHook(() => useCatalog(CATALOG));
  await waitFor(() => expect(result.current.rows).toHaveLength(3));
  expect(result.current.rows.map((r) => r.status)).toEqual(['queued', 'queued', 'queued']);
  expect(result.current.run?.filmId).toBe(FILM);
  expect(result.current.summary).toEqual({ total: 3, final: 0, ready: 0, fixed: 0, flagged: 0, failed: 0 });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(vi.mocked(useFilmEvents)).toHaveBeenCalledWith(FILM);
});

it('a row event replaces the row it names and leaves the other rows alone', async () => {
  const { result, rerender } = renderHook(() => useCatalog(CATALOG));
  await waitFor(() => expect(result.current.rows).toHaveLength(3));
  stream = [rowEvent(CATALOG, { ...row('can-original'), status: 'ready' })];
  rerender();
  await waitFor(() => expect(result.current.rows[0]?.status).toBe('ready'));
  expect(result.current.rows[1]?.status).toBe('queued');
  expect(result.current.rows[2]?.status).toBe('queued');
  expect(result.current.summary.ready).toBe(1);
});

it('an event for another catalog changes nothing', async () => {
  const { result, rerender } = renderHook(() => useCatalog(CATALOG));
  await waitFor(() => expect(result.current.rows).toHaveLength(3));
  stream = [rowEvent('cat_ffffffffffff', { ...row('can-original'), status: 'ready' })];
  rerender();
  expect(result.current.rows.map((r) => r.status)).toEqual(['queued', 'queued', 'queued']);
});

it('a foreign event is ignored while the run’s own event is applied', async () => {
  const { result, rerender } = renderHook(() => useCatalog(CATALOG));
  await waitFor(() => expect(result.current.rows).toHaveLength(3));
  stream = [
    rowEvent('cat_ffffffffffff', { ...row('can-original'), status: 'ready' }),
    rowEvent(CATALOG, { ...row('mug-stone'), status: 'fixed' }),
  ];
  rerender();
  await waitFor(() => expect(result.current.rows[1]?.status).toBe('fixed'));
  expect(result.current.rows[0]?.status).toBe('queued');
});

it('a restarted stream does not lose the events that come after it', async () => {
  const { result, rerender } = renderHook(() => useCatalog(CATALOG));
  await waitFor(() => expect(result.current.rows).toHaveLength(3));
  stream = [rowEvent(CATALOG, { ...row('can-original'), status: 'ready' })];
  rerender();
  await waitFor(() => expect(result.current.rows[0]?.status).toBe('ready'));

  // the stream restarts: the events are emptied and a new one arrives
  stream = [];
  rerender();
  stream = [rowEvent(CATALOG, { ...row('mug-stone'), status: 'fixed' })];
  rerender();
  await waitFor(() => expect(result.current.rows[1]?.status).toBe('fixed'));
  expect(result.current.rows[0]?.status).toBe('ready');
});

it('the run is done when the run says so', async () => {
  const { result, rerender } = renderHook(() => useCatalog(CATALOG));
  await waitFor(() => expect(result.current.rows).toHaveLength(3));
  stream = [{ filmId: FILM, at: '2026-11-01T10:00:02.000Z', type: 'catalog.done', catalogId: CATALOG, costUsd: 0.42, ms: 1200 }];
  rerender();
  await waitFor(() => expect(result.current.run?.state).toBe('done'));
  expect(result.current.run?.costUsd).toBe(0.42);
});

it('applyRow replaces a row right away', async () => {
  const { result } = renderHook(() => useCatalog(CATALOG));
  await waitFor(() => expect(result.current.rows).toHaveLength(3));
  act(() => result.current.applyRow({ ...row('mug-stone'), status: 'fixed', clipVersion: 1 }));
  expect(result.current.rows[1]?.status).toBe('fixed');
  expect(result.current.rows[1]?.clipVersion).toBe(1);
  expect(result.current.rows[0]?.status).toBe('queued');
});

it('reload reads the run again', async () => {
  const { result } = renderHook(() => useCatalog(CATALOG));
  await waitFor(() => expect(result.current.rows).toHaveLength(3));
  act(() => result.current.reload());
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
});

it('keeps the reason when the run cannot be read', async () => {
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'not_found' }), { status: 404 }));
  const { result } = renderHook(() => useCatalog(CATALOG));
  await waitFor(() => expect(result.current.error).toBeTruthy());
  expect((result.current.error as CatalogError).code).toBe('not_found');
  expect(result.current.rows).toEqual([]);
});

it('does nothing without a catalog id', () => {
  const { result } = renderHook(() => useCatalog(null));
  expect(result.current.run).toBeNull();
  expect(result.current.rows).toEqual([]);
  expect(fetchMock).not.toHaveBeenCalled();
  // the stream is only opened for a run, so there is nothing to watch yet
  expect(vi.mocked(useFilmEvents)).toHaveBeenCalledWith(null);
});
