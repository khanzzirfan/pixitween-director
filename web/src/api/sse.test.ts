import { renderHook } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useFilmEvents } from './sse';

class FakeEventSource {
  static last: FakeEventSource | undefined;
  closed = false;
  private handlers: Record<string, Array<(e: MessageEvent) => void>> = {};
  constructor(public url: string) {
    FakeEventSource.last = this;
  }
  addEventListener(type: string, fn: (e: MessageEvent) => void) {
    (this.handlers[type] ??= []).push(fn);
  }
  close() {
    this.closed = true;
  }
  deliver(id: string, data: unknown) {
    for (const fn of this.handlers.film ?? []) fn(new MessageEvent('film', { data: JSON.stringify(data), lastEventId: id }));
  }
}

beforeEach(() => vi.stubGlobal('EventSource', FakeEventSource));
afterEach(() => vi.unstubAllGlobals());

const ev = (text: string) => ({ filmId: 'film_aaaaaaaaaaaa', at: 'x', type: 'listener.transcript', text });

it('drops duplicate seqs and closes on unmount', () => {
  const { result, unmount } = renderHook(() => useFilmEvents('film_aaaaaaaaaaaa'));
  const es = FakeEventSource.last!;
  expect(es.url).toBe('/api/films/film_aaaaaaaaaaaa/events');
  act(() => {
    es.deliver('1', ev('a'));
    es.deliver('2', ev('b'));
    es.deliver('2', ev('b'));
  });
  expect(result.current).toHaveLength(2);
  unmount();
  expect(es.closed).toBe(true);
});

it('opens nothing without a film id', () => {
  FakeEventSource.last = undefined;
  renderHook(() => useFilmEvents(null));
  expect(FakeEventSource.last).toBeUndefined();
});
