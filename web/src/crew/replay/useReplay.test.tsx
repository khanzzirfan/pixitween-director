import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { FilmVersion } from '@shared/composition';
import { foldCrew } from '../crewReducer';
import { FIXTURE } from '../test-fixture';
import { useReplay, versionAt } from './useReplay';

const comp = (n: number) => ({ id: `c${n}` }) as unknown as FilmVersion['composition'];
const first = FIXTURE[0]!.at;
const last = FIXTURE[FIXTURE.length - 1]!.at;
const versions: FilmVersion[] = [
  { version: 1, composition: comp(1), source: 'director', at: first },
  { version: 2, composition: comp(2), source: 'director', at: FIXTURE[20]!.at },
  { version: 3, composition: comp(3), source: 'director', at: last },
];

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it('after playing the whole fixture the crew state equals folding all events and the picture is the last version', async () => {
  const { result } = renderHook(() => useReplay(FIXTURE, versions, { autoplay: true, speed: 8 }));
  expect(result.current.playing).toBe(true);
  await act(async () => void (await vi.advanceTimersByTimeAsync(result.current.durationMs + 500)));
  expect(result.current.done).toBe(true);
  expect(result.current.playing).toBe(false);
  expect(result.current.crew).toEqual(foldCrew(FIXTURE));
  expect(result.current.composition).toBe(versions[2]!.composition);
  expect(result.current.version).toBe(3);
  expect(result.current.progress).toBe(1);
});

it('seek(0.5) shows the first half of the scheduled events', () => {
  const { result } = renderHook(() => useReplay(FIXTURE, versions));
  act(() => result.current.seek(0.5));
  const half = Math.round(FIXTURE.length / 2);
  expect(result.current.shown).toEqual(FIXTURE.slice(0, half));
  expect(result.current.crew).toEqual(foldCrew(FIXTURE.slice(0, half)));
  expect(result.current.playing).toBe(false);
});

it('picks the newest version that existed by the latest shown event', () => {
  expect(versionAt(versions, undefined)).toBeUndefined();
  expect(versionAt(versions, FIXTURE[5]!.at)?.version).toBe(1);
  expect(versionAt(versions, FIXTURE[25]!.at)?.version).toBe(2);
});

it('continues from where it was paused, restarts from the top when done, and changes speed in place', async () => {
  const { result } = renderHook(() => useReplay(FIXTURE, versions, { speed: 1 }));
  act(() => result.current.seek(0.25));
  const at = result.current.shown.length;
  act(() => result.current.play());
  await act(async () => void (await vi.advanceTimersByTimeAsync(300)));
  expect(result.current.shown.length).toBeGreaterThanOrEqual(at);
  act(() => result.current.pause());
  const paused = result.current.shown.length;
  await act(async () => void (await vi.advanceTimersByTimeAsync(5000)));
  expect(result.current.shown.length).toBe(paused);
  act(() => result.current.setSpeed(8));
  expect(result.current.shown.length).toBe(paused);
  act(() => result.current.seek(1));
  expect(result.current.done).toBe(true);
  act(() => result.current.play());
  expect(result.current.shown.length).toBe(0);
  expect(result.current.playing).toBe(true);
});

it('shows nothing and never plays an empty log', () => {
  const { result } = renderHook(() => useReplay([], [], { autoplay: true }));
  expect(result.current.playing).toBe(false);
  expect(result.current.done).toBe(false);
  expect(result.current.crew.storyboard).toBeUndefined();
});
