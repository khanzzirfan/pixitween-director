import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from './App';
import * as client from './api/client';

afterEach(() => window.history.replaceState({}, '', '/'));

it('opens on the Brief screen: a board, an empty stage and the chat', () => {
  render(<App />);
  expect(screen.getByTestId('studio-board')).toBeInTheDocument();
  expect(screen.getByTestId('slot-player')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Make film' })).toBeDisabled();
});

it('opens the film named by ?film= and shows its status', async () => {
  const getFilm = vi.spyOn(client.api, 'getFilm').mockResolvedValue({ id: 'film_3fa9c2d41b7e', status: 'planning' } as never);
  vi.stubGlobal('EventSource', class { addEventListener() {} close() {} });
  window.history.replaceState({}, '', '/?film=film_3fa9c2d41b7e');
  render(<App />);
  expect(getFilm).toHaveBeenCalledWith('film_3fa9c2d41b7e');
  await waitFor(() => expect(screen.getByTestId('film-status')).toHaveTextContent('planning'));
  expect(screen.getByTestId('player-empty')).toBeInTheDocument(); // no composition yet
  vi.unstubAllGlobals();
});
