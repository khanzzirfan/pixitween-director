import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { FilmState } from '@shared/composition';
import { api } from './client';
import { useFilm } from './useFilm';

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  handlers: Array<(e: MessageEvent) => void> = [];
  closed = false;
  seq = 0;
  constructor() {
    FakeEventSource.instances.push(this);
  }
  addEventListener(_t: string, fn: (e: MessageEvent) => void) {
    this.handlers.push(fn);
  }
  close() {
    this.closed = true;
  }
  push(data: unknown) {
    this.seq++;
    for (const fn of this.handlers) fn(new MessageEvent('film', { data: JSON.stringify(data), lastEventId: String(this.seq) }));
  }
}
const toolCall = (version: number) => ({ filmId: 'film_aaaaaaaaaaaa', at: 'x', type: 'tool.call', name: 'addScene', args: {}, ok: true, version });
const film = (version: number) => ({ id: 'film_aaaaaaaaaaaa', version }) as FilmState;
const ID = 'film_aaaaaaaaaaaa';

let getFilm: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.useFakeTimers();
  getFilm = vi.spyOn(api, 'getFilm');
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('fetches once, then again 300 ms after a committing tool call', async () => {
  getFilm.mockResolvedValueOnce(film(1)).mockResolvedValueOnce(film(2));
  const { result } = renderHook(() => useFilm(ID));
  await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
  expect(result.current.film?.version).toBe(1);
  act(() => FakeEventSource.instances[0]!.push(toolCall(2)));
  expect(getFilm).toHaveBeenCalledTimes(1);
  await act(async () => void (await vi.advanceTimersByTimeAsync(300)));
  expect(getFilm).toHaveBeenCalledTimes(2);
  expect(result.current.film?.version).toBe(2);
  expect(result.current.events).toHaveLength(1);
});

it('debounces two events within 300 ms into one fetch', async () => {
  getFilm.mockResolvedValue(film(1));
  renderHook(() => useFilm(ID));
  await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
  act(() => FakeEventSource.instances[0]!.push(toolCall(2)));
  await act(async () => void (await vi.advanceTimersByTimeAsync(100)));
  act(() => FakeEventSource.instances[0]!.push({ filmId: ID, at: 'x', type: 'film.status', status: 'building' }));
  await act(async () => void (await vi.advanceTimersByTimeAsync(400)));
  expect(getFilm).toHaveBeenCalledTimes(2);
});

it('ignores events that do not change the film', async () => {
  getFilm.mockResolvedValue(film(1));
  renderHook(() => useFilm(ID));
  await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
  act(() => FakeEventSource.instances[0]!.push({ filmId: ID, at: 'x', type: 'listener.transcript', text: 'hi' }));
  await act(async () => void (await vi.advanceTimersByTimeAsync(500)));
  expect(getFilm).toHaveBeenCalledTimes(1);
});

it('drops a stale slow response', async () => {
  let resolveSlow!: (f: FilmState) => void;
  getFilm.mockImplementationOnce(() => new Promise<FilmState>((r) => (resolveSlow = r))).mockResolvedValueOnce(film(2));
  const { result } = renderHook(() => useFilm(ID));
  act(() => FakeEventSource.instances[0]!.push(toolCall(2)));
  await act(async () => void (await vi.advanceTimersByTimeAsync(300)));
  expect(result.current.film?.version).toBe(2);
  await act(async () => resolveSlow(film(1)));
  expect(result.current.film?.version).toBe(2);
});

it('does nothing for a null film id', () => {
  const { result } = renderHook(() => useFilm(null));
  expect(result.current.film).toBeNull();
  expect(getFilm).not.toHaveBeenCalled();
  expect(FakeEventSource.instances).toHaveLength(0);
});
