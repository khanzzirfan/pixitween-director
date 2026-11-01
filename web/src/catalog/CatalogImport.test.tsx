import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type * as CatalogApi from './api';
import { CatalogError, importCatalog, listCatalogs } from './api';
import CatalogImport from './CatalogImport';
import { App } from '../App';

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof CatalogApi>();
  return { ...actual, importCatalog: vi.fn(), listCatalogs: vi.fn() };
});

const importMock = vi.mocked(importCatalog);
const listMock = vi.mocked(listCatalogs);

const CATALOG = 'cat_0123456789ab';
const FILM = 'film_0123456789ab';

const run = (id: string, total: number, final: number, state: 'running' | 'done' = 'done') => ({
  id,
  filmId: FILM,
  createdAt: '2026-11-01T10:00:00.000Z',
  state,
  total,
  final,
});

beforeEach(() => {
  window.history.replaceState({}, '', '/');
  importMock.mockReset();
  listMock.mockReset();
  listMock.mockResolvedValue({ runs: [] });
});

afterEach(() => {
  window.history.replaceState({}, '', '/');
});

it('the demo button posts the demo feed and opens the run it started', async () => {
  importMock.mockResolvedValue({ catalogId: CATALOG, filmId: FILM });
  render(<CatalogImport />);

  fireEvent.click(screen.getByRole('button', { name: 'Use demo feed (6 products)' }));

  expect(importMock).toHaveBeenCalledTimes(1);
  const form = importMock.mock.calls[0][0];
  expect(form).toBeInstanceOf(FormData);
  expect(form.get('demo')).toBe('feed-6');
  expect(form.get('csv')).toBeNull();
  await waitFor(() => expect(window.location.search).toBe(`?catalog=${CATALOG}`));
});

it('the form sends the CSV, the photos and the aspect', async () => {
  importMock.mockResolvedValue({ catalogId: CATALOG, filmId: FILM });
  render(<CatalogImport />);

  const csv = new File(['id,title\ncan-1,Can'], 'feed.csv', { type: 'text/csv' });
  fireEvent.change(screen.getByLabelText('Product CSV'), { target: { files: [csv] } });
  const photo = new File([new Uint8Array([1, 2, 3])], 'can.png', { type: 'image/png' });
  fireEvent.change(screen.getByLabelText('Photos'), { target: { files: [photo] } });

  fireEvent.click(screen.getByRole('button', { name: 'Build catalog' }));

  const form = importMock.mock.calls[0][0];
  expect((form.get('csv') as File).name).toBe('feed.csv');
  expect((form.get('photos') as File).name).toBe('can.png');
  expect(form.get('aspect')).toBe('9:16');
  expect(form.get('demo')).toBeNull();
});

it('a refused feed shows one list item per bad column', async () => {
  importMock.mockRejectedValue(new CatalogError(400, 'bad_feed', ['the feed header is missing: price', 'the feed has no rows']));
  render(<CatalogImport />);

  fireEvent.click(screen.getByRole('button', { name: 'Use demo feed (6 products)' }));

  await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  const items = screen.getAllByRole('listitem');
  expect(items).toHaveLength(2);
  expect(items[0]).toHaveTextContent('the feed header is missing: price');
  expect(items[1]).toHaveTextContent('the feed has no rows');
  expect(screen.getByRole('alert')).toHaveTextContent('bad_feed');
  // the refusal never opens a run
  expect(window.location.search).toBe('');
});

it('a refusal that names no columns is one message', async () => {
  importMock.mockRejectedValue(new CatalogError(503, 'meta_key_missing'));
  render(<CatalogImport />);

  fireEvent.click(screen.getByRole('button', { name: 'Use demo feed (6 products)' }));

  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('meta_key_missing'));
  expect(screen.queryAllByRole('listitem')).toHaveLength(0);
});

it('the recent runs are listed and open the run they name', async () => {
  listMock.mockResolvedValue({ runs: [run(CATALOG, 6, 6), run('cat_ffffffffffff', 3, 1, 'running')] });
  render(<CatalogImport />);

  const first = await screen.findByRole('button', { name: 'Catalog: 6 products · done · 6/6' });
  expect(screen.getByRole('button', { name: 'Catalog: 3 products · running · 1/3' })).toBeInTheDocument();

  fireEvent.click(first);
  expect(window.location.search).toBe(`?catalog=${CATALOG}`);
});

it('shows the header the feed has to carry, and the aspect it starts with', () => {
  render(<CatalogImport />);
  expect(screen.getByText('id,title,price,sale_price,currency,image_link,category,link,brand')).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: '9:16' })).toBeChecked();
});

it('the studio rail shows the Catalog tab on a new film', () => {
  render(<App />);
  expect(screen.getByTestId('rail-catalog')).toBeInTheDocument();
  expect(screen.getByTestId('slot-catalog')).toBeInTheDocument();
});
