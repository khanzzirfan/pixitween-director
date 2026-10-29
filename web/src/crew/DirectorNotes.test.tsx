import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { FilmEvent } from '@shared/events';
import { DirectorNotes } from './DirectorNotes';
import { crewReducer, foldCrew, initialCrewState } from './crewReducer';
import { FIXTURE, upTo } from './test-fixture';

const F = 'film_0123456789ab';
it('renders an ask note as buttons and sends the clicked option', () => {
  const onAsk = vi.fn();
  render(<DirectorNotes crew={foldCrew(FIXTURE)} onAsk={onAsk} />);
  expect(screen.getByRole('button', { name: 'Keep it' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Make it night' }));
  expect(onAsk).toHaveBeenCalledWith('Make it night');
});

it('shows a heard message at once, before any reply', () => {
  const heard = { filmId: F, at: '2026-10-30T14:05:00.000Z', type: 'showrunner.heard', inboxId: 'i9', from: 'user', text: 'make it warmer' } as FilmEvent;
  render(<DirectorNotes crew={crewReducer(initialCrewState, heard)} onAsk={vi.fn()} />);
  expect(screen.getByText('make it warmer')).toBeInTheDocument();
  expect(screen.getByText('heard')).toBeInTheDocument();
});

it('shows a thinking line with elapsed seconds while the showrunner thinks', () => {
  render(<DirectorNotes crew={foldCrew(upTo(2))} now={Date.parse('2026-10-30T14:00:13.000Z')} onAsk={vi.fn()} />);
  expect(screen.getByText(/thinking · 12 s/)).toBeInTheDocument();
});

it('only the newest ask is answerable', () => {
  const crew = foldCrew([
    { filmId: F, at: '2026-10-30T14:00:01.000Z', type: 'showrunner.say', kind: 'ask', text: 'one?', options: ['a', 'b'] },
    { filmId: F, at: '2026-10-30T14:00:02.000Z', type: 'showrunner.say', kind: 'ask', text: 'two?', options: ['c', 'd'] },
  ] as FilmEvent[]);
  render(<DirectorNotes crew={crew} onAsk={vi.fn()} />);
  expect(screen.getByRole('button', { name: 'a' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'c' })).toBeEnabled();
});
