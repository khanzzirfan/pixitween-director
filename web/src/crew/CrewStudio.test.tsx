import { render, screen, waitFor } from '@testing-library/react';
import { forwardRef } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from '../App';
import * as client from '../api/client';

vi.mock('../player/Player', () => ({ default: forwardRef(() => <div data-testid="player-stub" />) }));

afterEach(() => {
  window.history.replaceState({}, '', '/');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const film = (crew: boolean) =>
  ({ id: 'film_3fa9c2d41b7e', status: 'building', aspect: '16:9', crew, version: 1, assets: [], brief: { text: 'a mug', productAssetId: 'ast_x' }, composition: null }) as never;

function open(f: unknown) {
  vi.spyOn(client.api, 'getFilm').mockResolvedValue(f as never);
  vi.stubGlobal('EventSource', class { addEventListener() {} close() {} });
  window.history.replaceState({}, '', '/?film=film_3fa9c2d41b7e');
  return render(<App />);
}

it('a crew film gets the studio: crew board and live storyboard, not the classic storyboard panel', async () => {
  open(film(true));
  expect(await screen.findByTestId('crew-studio')).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Crew' })).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Storyboard' })).toBeInTheDocument();
  expect(screen.queryByTestId('slot-storyboard')).toBeNull();
  expect(screen.queryByTestId('slot-review')).toBeNull();
});

it('a classic film renders the classic panels exactly as before', async () => {
  open(film(false));
  await waitFor(() => expect(screen.getByTestId('film-status')).toHaveTextContent('building'));
  for (const n of ['new-film', 'storyboard', 'player', 'review', 'chat', 'generate', 'export', 'gallery']) expect(screen.getByTestId(`slot-${n}`)).toBeInTheDocument();
  expect(screen.queryByTestId('crew-studio')).toBeNull();
});

it('puts the player before the conversation, the crew and the plan in the page order (it is first on a phone)', async () => {
  open(film(true));
  const studio = await screen.findByTestId('crew-studio');
  const cols = [...studio.querySelectorAll('.studio-grid > .col')].map((c) => c.className);
  expect(cols).toEqual(['col col-plan', 'col col-stage', 'col col-crew']); // css `order` puts the stage first below 1100 px
});
