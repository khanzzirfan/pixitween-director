import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { FilmState } from '@shared/composition';
import Gallery from './Gallery';

const comp = { version: '1.0.0', id: 'c', width: 1, height: 1, fps: 30, durationInFrames: 360, assets: {}, layers: [] };
const sc = (id: string, mode: string) => ({ id, mode });
const film = (o: Record<string, unknown>): FilmState =>
  ({ id: 'f', aspect: '16:9', status: 'ready', brief: { text: '', productAssetId: 'ast_p' }, version: 1, assets: [], costUsd: 0, clippyCredits: 0, createdAt: '2026-11-01T10:00:00Z', composition: comp, ...o }) as unknown as FilmState;
const films = [
  film({ id: 'gen', title: 'Generate film', storyboard: { scenes: [sc('a', 'motion'), sc('b', 'generate')] } }),
  film({ id: 'mot', title: 'Motion film', createdAt: '2026-11-02T09:00:00Z', storyboard: { scenes: [sc('a', 'motion')] } }),
  film({ id: 'bld', status: 'building' }),
];

afterEach(() => window.history.replaceState({}, '', '/'));

it('renders a card per ready film with badges and thumbnails', async () => {
  render(<Gallery fetchFilms={async () => films} onOpen={() => undefined} />);
  const cards = await screen.findAllByRole('button', { name: /,/ });
  expect(cards).toHaveLength(2);
  expect(screen.getByText('Includes generated clip')).toBeInTheDocument();
  expect(screen.getByText('Motion only')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Motion film, 0:12' })).toBeInTheDocument();
  const img = screen.getByAltText('Motion film');
  expect(img).toHaveAttribute('src', '/api/assets/ast_p');
});
it('shows the empty and error states', async () => {
  const { unmount } = render(<Gallery fetchFilms={async () => []} />);
  expect(await screen.findByText('No finished films yet')).toBeInTheDocument();
  unmount();
  const fetchFilms = vi.fn().mockRejectedValue(new Error('down'));
  render(<Gallery fetchFilms={fetchFilms} />);
  expect(await screen.findByText('Could not load films')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(fetchFilms).toHaveBeenCalledTimes(2));
});
it('opens a film through onOpen, or by setting ?film= by default', async () => {
  const onOpen = vi.fn();
  const { unmount } = render(<Gallery fetchFilms={async () => films} onOpen={onOpen} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Generate film, 0:12' }));
  expect(onOpen).toHaveBeenCalledWith('gen');
  unmount();
  render(<Gallery fetchFilms={async () => films} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Motion film, 0:12' }));
  expect(window.location.search).toBe('?film=mot');
});
