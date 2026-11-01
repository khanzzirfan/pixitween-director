// Owned by Catalog Crew C1 (US-011). The catalog page: the wall, and one player for the row that is picked.
import { forwardRef } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { AepCompositionJson } from '@shared/aep';
import type { CatalogRow, CatalogRun } from '@shared/catalog-run';
import type * as CatalogApi from './api';
import { getCatalog, getClip } from './api';
import CatalogPage from './CatalogPage';

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof CatalogApi>();
  return { ...actual, getCatalog: vi.fn(), getClip: vi.fn() };
});
vi.mock('../api/sse', () => ({ useFilmEvents: vi.fn(() => []) }));
// The real Player needs WebGL; this stand-in shows which composition it was given.
vi.mock('../player/Player', () => ({
  default: forwardRef(function PlayerStub(props: { composition: { id: string } | null }, _ref: unknown) {
    return <div data-testid="player-stub" data-composition={props.composition?.id ?? 'none'} />;
  }),
}));

const CATALOG = 'cat_0123456789ab';
const FILM = 'film_0123456789ab';

const COMP: AepCompositionJson = {
  version: '1.9.0',
  id: 'clip-can-original',
  width: 1080,
  height: 1920,
  fps: 30,
  durationInFrames: 120,
  assets: {},
  layers: [],
};

const row = (id: string, title: string, over: Partial<CatalogRow> = {}): CatalogRow => ({
  product: { id, title, price: 12, currency: 'USD', imageUrl: `fixtures/${id}.png`, category: 'cans' },
  status: 'ready',
  look: 'price-promo',
  clipVersion: 1,
  check: { ok: true, rounds: 1, applied: [], blocking: [], warnings: [] },
  ...over,
});

const RUN: CatalogRun = {
  id: CATALOG,
  filmId: FILM,
  aspect: '9:16',
  createdAt: '2026-11-01T10:00:00.000Z',
  state: 'done',
  costUsd: 0.42,
  rows: [
    row('can-original', 'Sparkling Can'),
    row('mug-stone', 'Stone Mug'),
    row('mug-blue', 'Blue Mug', { status: 'building', check: null }),
  ],
};

beforeEach(() => {
  vi.mocked(getCatalog).mockReset().mockResolvedValue(RUN);
  vi.mocked(getClip).mockReset().mockResolvedValue(COMP);
});

it('mounts one player and no more, whatever the owner picks', async () => {
  render(<CatalogPage catalogId={CATALOG} />);
  await screen.findByText('Sparkling Can');

  expect(screen.getAllByTestId('slot-player')).toHaveLength(1);
  expect(screen.getAllByTestId('player-stub')).toHaveLength(1);

  fireEvent.click(screen.getByText('Stone Mug'));
  await waitFor(() => expect(screen.getAllByTestId('player-stub')).toHaveLength(1));
  expect(screen.getAllByTestId('slot-player')).toHaveLength(1);
});

it('plays the clip of the row that is picked', async () => {
  render(<CatalogPage catalogId={CATALOG} />);
  await screen.findByText('Sparkling Can');

  fireEvent.click(screen.getByText('Stone Mug'));

  await waitFor(() => expect(getClip).toHaveBeenCalledWith(CATALOG, 'mug-stone'));
  await waitFor(() => expect(screen.getByTestId('player-stub')).toHaveAttribute('data-composition', COMP.id));
});

it('a row that is still moving has no clip to play', async () => {
  render(<CatalogPage catalogId={CATALOG} />);
  await screen.findByText('Blue Mug');

  fireEvent.click(screen.getByText('Blue Mug'));
  await waitFor(() => expect(getClip).toHaveBeenCalled());
  expect(getClip).not.toHaveBeenCalledWith(CATALOG, 'mug-blue');
});

it('plays the first finished row on open, so the stage is never empty', async () => {
  render(<CatalogPage catalogId={CATALOG} />);
  await waitFor(() => expect(getClip).toHaveBeenCalledWith(CATALOG, 'can-original'));
  await waitFor(() => expect(screen.getByTestId('player-stub')).toHaveAttribute('data-composition', COMP.id));
});

it('waits with an empty stage while no row is finished', async () => {
  vi.mocked(getCatalog).mockResolvedValue({ ...RUN, state: 'running', rows: RUN.rows.map((r) => ({ ...r, status: 'building', check: null })) });
  render(<CatalogPage catalogId={CATALOG} />);
  await screen.findByText('Sparkling Can');
  expect(screen.getByTestId('player-stub')).toHaveAttribute('data-composition', 'none');
  expect(getClip).not.toHaveBeenCalled();
});

it('names the run in the title and counts it in the wall', async () => {
  render(<CatalogPage catalogId={CATALOG} />);
  await screen.findByText('Sparkling Can');
  expect(screen.getByTitle('Catalog: 3 products')).toBeInTheDocument();
  expect(screen.getByTestId('catalog-head')).toHaveTextContent('2/3 done · 2 ready · 0 fixed · 0 flagged');
});
