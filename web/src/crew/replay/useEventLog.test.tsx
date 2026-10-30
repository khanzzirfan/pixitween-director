import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useEventLog } from './useEventLog';

afterEach(() => vi.unstubAllGlobals());

const ev = (type: string, n: number) => ({ filmId: 'f1', at: `2026-10-30T14:00:0${n}.000Z`, type, status: 'planning' });

it('requests the log exactly once and keeps the order received', async () => {
  const events = [ev('film.status', 2), ev('film.status', 1)];
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(events), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  const { result, rerender } = renderHook(() => useEventLog('f1'));
  await waitFor(() => expect(result.current.loading).toBe(false));
  rerender();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[0]).toBe('/api/films/f1/log');
  expect(result.current.events).toEqual(events);
  expect(result.current.error).toBeUndefined();
});

it('sets not_found and no events on a 404', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"not_found"}', { status: 404 })));
  const { result } = renderHook(() => useEventLog('f1'));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.error).toBe('not_found');
  expect(result.current.events).toEqual([]);
});

it('does not fetch without a film id', () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  const { result } = renderHook(() => useEventLog(null));
  expect(result.current.loading).toBe(false);
  expect(fetchMock).not.toHaveBeenCalled();
});
