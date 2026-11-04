import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import type { Lineup } from '@shared/lineup';
import { LineupNote, LineupTabs } from './LineupTabs';

afterEach(() => window.history.replaceState({}, '', '/'));

const product = (id: string, title: string) => ({ id, title, price: 10, currency: 'USD', imageUrl: 'x.png', category: 'c' });
const lineup: Lineup = {
  id: 'lin_abcdefgh',
  aspect: '9:16',
  createdAt: '2026-01-01',
  brief: '',
  items: [
    { product: product('a', 'Rose Orchid'), filmId: 'film_a', state: 'done' },
    { product: product('b', 'Forest Oud'), filmId: 'film_b', state: 'making' },
    { product: product('c', 'Amber Mist'), filmId: 'film_c', state: 'waiting' },
    { product: product('d', 'No Photo'), state: 'failed', error: 'photo not found: d.png' },
  ],
};

it('shows a tab per product and opens that product’s film, keeping the line-up', () => {
  render(<LineupTabs lineup={lineup} filmId="film_b" />);
  expect(screen.getAllByRole('tab')).toHaveLength(4);
  expect(screen.getByRole('tab', { name: /Product 2/ })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('tab', { name: /Product 4/ })).toBeDisabled();
  fireEvent.click(screen.getByRole('tab', { name: /Product 1/ }));
  expect(window.location.search).toContain('film=film_a');
  expect(window.location.search).toContain('lineup=lin_abcdefgh');
});

it('the chat note says which product the crew is on, and lets you jump to it', () => {
  render(<LineupNote lineup={lineup} filmId="film_a" />);
  expect(screen.getByText(/Making product 2 of 4: Forest Oud/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Watch it' }));
  expect(window.location.search).toContain('film=film_b');
});
