import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { foldCrew } from './crewReducer';
import { CrewBoard } from './CrewBoard';
import { FIXTURE, MARKS, upTo } from './test-fixture';

afterEach(() => localStorage.clear());
const T = (s: number) => Date.parse(`2026-10-30T14:00:${String(s).padStart(2, '0')}.000Z`);

it('shows 4 builder rows with a working pill at the 4-builds point', () => {
  render(<CrewBoard crew={foldCrew(upTo(MARKS.fourBuilds))} now={T(9)} />);
  const rows = document.querySelectorAll('.lane-builder');
  expect(rows).toHaveLength(4);
  for (const r of rows) expect(within(r as HTMLElement).getByText('working')).toBeInTheDocument();
});

it('names the showrunner model and keeps the fixed lanes', () => {
  render(<CrewBoard crew={foldCrew(upTo(MARKS.fourBuilds))} now={T(9)} />);
  expect(screen.getByText('Muse Wonder')).toBeInTheDocument();
  for (const n of ['Showrunner', 'Critic', 'Continuity', 'Producer', 'Listener', 'Local']) expect(screen.getByText(n)).toBeInTheDocument();
});

it('a lane thinking since 12 s ago shows 12 s', () => {
  vi.useFakeTimers();
  const crew = foldCrew(upTo(2)); // showrunner thinking from 14:00:01
  render(<CrewBoard crew={crew} now={T(13)} />);
  expect(screen.getByText('12 s')).toBeInTheDocument();
  vi.useRealTimers();
});

it('shows each lane its newest chips and passes cancel through', () => {
  const onCancel = vi.fn();
  render(<CrewBoard crew={foldCrew(upTo(MARKS.fourBuilds))} now={T(9)} onCancel={onCancel} />);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel j2' }));
  expect(onCancel).toHaveBeenCalledWith('j2');
});

it('switches Lanes and Map with ArrowRight, remembers the choice, and falls back to Lanes when storage throws', () => {
  const crew = foldCrew(FIXTURE);
  const { unmount } = render(<CrewBoard crew={crew} now={T(9)} />);
  const lanes = screen.getByRole('tab', { name: 'Lanes' });
  expect(lanes).toHaveAttribute('aria-selected', 'true');
  fireEvent.keyDown(lanes, { key: 'ArrowRight' });
  expect(screen.getByRole('tab', { name: 'Map' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('group', { name: 'Crew map' })).toBeInTheDocument();
  unmount();
  render(<CrewBoard crew={crew} now={T(9)} />);
  expect(screen.getByRole('tab', { name: 'Map' })).toHaveAttribute('aria-selected', 'true'); // survived the remount
  fireEvent.click(screen.getByRole('tab', { name: 'Lanes' }));
  expect(document.querySelector('.lanes')).toBeTruthy();
  const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  cleanupAndRender(crew);
  expect(screen.getByRole('tab', { name: 'Lanes' })).toHaveAttribute('aria-selected', 'true');
  get.mockRestore();
});

function cleanupAndRender(crew: ReturnType<typeof foldCrew>) {
  document.body.innerHTML = '';
  render(<CrewBoard crew={crew} now={T(9)} />);
}
