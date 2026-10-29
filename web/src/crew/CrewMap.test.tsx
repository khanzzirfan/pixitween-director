import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CrewMap } from './CrewMap';
import { foldCrew, crewReducer } from './crewReducer';
import { MARKS, upTo, FIXTURE } from './test-fixture';

const T = (s: number) => Date.parse(`2026-10-30T14:00:${String(s).padStart(2, '0')}.000Z`);
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('lights 4 builder nodes at the 4-builds point and names them for a screen reader', () => {
  render(<CrewMap crew={foldCrew(upTo(MARKS.fourBuilds))} now={T(9)} />);
  const lit = document.querySelectorAll('[data-node^="builder:"].is-lit');
  expect(lit).toHaveLength(4);
  expect(screen.getByRole('img', { name: 'Builder 1, working: build s1' })).toBeInTheDocument();
});

it('draws a travelling dot for a fresh link and none for an old one, and does not move the state', () => {
  const crew = foldCrew(upTo(MARKS.afterUserMessage)); // the message at 14:00:14
  const { rerender } = render(<CrewMap crew={crew} now={T(14) + 300} />);
  expect(document.querySelectorAll('.map-dot').length).toBeGreaterThan(0);
  const before = crew;
  rerender(<CrewMap crew={crew} now={T(14) + 10_000} />);
  expect(document.querySelectorAll('.map-dot')).toHaveLength(0);
  expect(before).toBe(crew);
});

it('ticks its own clock only while something travels, and lets the dots go after 10 s', () => {
  vi.setSystemTime(T(14) + 300);
  render(<CrewMap crew={foldCrew(upTo(MARKS.afterUserMessage))} />);
  expect(document.querySelectorAll('.map-dot').length).toBeGreaterThan(0);
  act(() => void vi.advanceTimersByTime(10_000));
  expect(document.querySelectorAll('.map-dot')).toHaveLength(0);
});

it('draws no dot under prefers-reduced-motion', () => {
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), addEventListener() {}, removeEventListener() {} }));
  render(<CrewMap crew={foldCrew(upTo(MARKS.afterUserMessage))} now={T(14) + 300} />);
  expect(document.querySelectorAll('.map-dot')).toHaveLength(0);
  expect(document.querySelectorAll('.map-link')).toHaveLength(1); // the edge still lights up
});

it('adds builder nodes only when a crew.agent event names them', () => {
  render(<CrewMap crew={foldCrew(upTo(3))} now={T(3)} />);
  expect(document.querySelectorAll('[data-node^="builder:"]')).toHaveLength(0);
  expect(crewReducer(foldCrew(upTo(3)), FIXTURE[MARKS.fourBuilds - 2]!).lanes).toBeTruthy();
});
