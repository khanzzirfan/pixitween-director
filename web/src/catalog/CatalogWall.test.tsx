// Owned by Catalog Crew C1 (US-011). The wall of products.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { expect, it, vi } from 'vitest';
import type { CatalogRow, RowStatus } from '@shared/catalog-run';
import { editProduct } from './api';
import CatalogWall from './CatalogWall';

vi.mock('./api', () => ({ editProduct: vi.fn() }));

const product = (id: string, title: string, over: Partial<CatalogRow['product']> = {}) => ({
  id,
  title,
  price: 12,
  currency: 'USD',
  imageUrl: `fixtures/${id}.png`,
  category: 'cans',
  ...over,
});

const row = (id: string, title: string, status: RowStatus, over: Partial<CatalogRow> = {}): CatalogRow => ({
  product: product(id, title),
  status,
  look: 'price-promo',
  clipVersion: 1,
  check: null,
  ...over,
});

/** The wall the story names: 2 ready, 1 fixed, 1 flagged and 2 building. */
const wall = (): CatalogRow[] => [
  row('can-original', 'Sparkling Can', 'ready', { check: { ok: true, rounds: 1, applied: [], blocking: [], warnings: [] } }),
  row('can-zero', 'Zero Sugar Can', 'ready', { check: { ok: true, rounds: 1, applied: [], blocking: [], warnings: ['TINY_TEXT brand'] } }),
  row('mug-stone', 'Stone Mug', 'fixed', { check: { ok: true, rounds: 2, applied: ['baseY 0.5 -> 0.7347'], blocking: [], warnings: [] } }),
  row('mug-blue', 'Blue Mug', 'flagged', { check: { ok: false, rounds: 2, applied: [], blocking: ['NOT_CONTAINED caption_price'], warnings: [] } }),
  row('tea-green', 'Green Tea', 'building'),
  row('tea-black', 'Black Tea', 'building'),
];

it('counts the rows the way the run ended', () => {
  render(<CatalogWall rows={wall()} />);
  expect(screen.getByText('4/6 done · 2 ready · 1 fixed · 1 flagged')).toBeInTheDocument();
});

it('takes the counts and the cost when the run gives them', () => {
  render(<CatalogWall rows={wall()} summary={{ total: 6, final: 6, ready: 3, fixed: 2, flagged: 1, failed: 0 }} costUsd={0.42} />);
  expect(screen.getByText('6/6 done · 3 ready · 2 fixed · 1 flagged')).toBeInTheDocument();
  expect(screen.getByText('$0.42')).toBeInTheDocument();
});

it('gives every row its title, its price, its look and its two chips', () => {
  render(<CatalogWall rows={wall()} />);
  expect(screen.getByText('Sparkling Can')).toBeInTheDocument();
  expect(screen.getAllByText('$12.00')).toHaveLength(6);
  expect(screen.getAllByText('price-promo')).toHaveLength(6);
  expect(screen.getByText('✔ checked, 0 notes')).toBeInTheDocument();
  expect(screen.getByText('✔ checked, 1 note')).toBeInTheDocument();
  expect(screen.getByText('⚑ fixed: baseY 0.5 -> 0.7347')).toBeInTheDocument();
  expect(screen.getByText('⚑ NOT_CONTAINED caption_price')).toBeInTheDocument();
  expect(screen.getAllByText('building')).toHaveLength(2);
});

it('strikes the old price through when the product is on sale', () => {
  const rows = [row('mug-stone', 'Stone Mug', 'ready', { product: product('mug-stone', 'Stone Mug', { price: 24, salePrice: 19 }) })];
  render(<CatalogWall rows={rows} />);
  expect(screen.getByText('$19.00')).toBeInTheDocument();
  expect(screen.getByText('$24.00').tagName).toBe('S');
});

it('a final row can be picked, a row that is still moving cannot', () => {
  const onSelect = vi.fn();
  render(<CatalogWall rows={wall()} onSelect={onSelect} />);

  fireEvent.click(screen.getByText('Stone Mug'));
  expect(onSelect).toHaveBeenCalledWith('mug-stone');

  fireEvent.click(screen.getAllByText('Green Tea')[0]!);
  expect(onSelect).toHaveBeenCalledTimes(1);
});

/** A wall that keeps the row the answer gives, the way the page does. */
function Editable({ rows }: { rows: CatalogRow[] }) {
  const [now, setNow] = useState(rows);
  return <CatalogWall rows={now} selected="mug-stone" catalogId="cat_1" onEdited={(r) => setNow((all) => all.map((x) => (x.product.id === r.product.id ? r : x)))} />;
}

it('a price typed on the picked row is sent, shown and timed at $0', async () => {
  const stone = wall()[2]!;
  vi.mocked(editProduct).mockResolvedValue({ row: { ...stone, product: { ...stone.product, price: 19 }, clipVersion: 2, ms: 140 } });
  render(<Editable rows={wall()} />);

  const input = screen.getByLabelText('Price of Stone Mug');
  fireEvent.change(input, { target: { value: '19' } });
  fireEvent.keyDown(input, { key: 'Enter' });

  expect(screen.getByText('Updating…')).toBeInTheDocument();
  expect(editProduct).toHaveBeenCalledTimes(1);
  expect(editProduct).toHaveBeenCalledWith('cat_1', 'mug-stone', { price: 19, salePrice: null });
  expect(await screen.findByText('updated in 140 ms · $0.00')).toBeInTheDocument();
  await waitFor(() => expect(screen.getAllByText('$19.00').length).toBeGreaterThan(0));
});

it('a sale sends the old price as the price and the typed one as the sale price', async () => {
  const stone = wall()[2]!;
  vi.mocked(editProduct).mockClear();
  vi.mocked(editProduct).mockResolvedValue({ row: { ...stone, product: { ...stone.product, price: 24, salePrice: 19 }, ms: 90 } });
  render(<Editable rows={wall()} />);

  fireEvent.click(screen.getByLabelText('on sale'));
  fireEvent.change(screen.getByLabelText('Old price of Stone Mug'), { target: { value: '24' } });
  fireEvent.change(screen.getByLabelText('Price of Stone Mug'), { target: { value: '19' } });
  fireEvent.click(screen.getByText('Save'));

  await screen.findByText('updated in 90 ms · $0.00');
  expect(editProduct).toHaveBeenCalledWith('cat_1', 'mug-stone', { price: 24, salePrice: 19 });
});

it('a price that is not a price is refused before anything is sent', () => {
  vi.mocked(editProduct).mockClear();
  render(<Editable rows={wall()} />);

  const input = screen.getByLabelText('Price of Stone Mug');
  fireEvent.change(input, { target: { value: '-3' } });
  fireEvent.keyDown(input, { key: 'Enter' });

  expect(screen.getByText('Enter a price like 19.00')).toBeInTheDocument();
  expect(editProduct).not.toHaveBeenCalled();
});

it('shows the server\'s refusal under the price', async () => {
  vi.mocked(editProduct).mockRejectedValue(new Error('not_ready'));
  render(<Editable rows={wall()} />);

  fireEvent.click(screen.getByText('Save'));
  expect(await screen.findByText('not_ready')).toBeInTheDocument();
});

it('a sale price that is not below the old price is refused before anything is sent', () => {
  vi.mocked(editProduct).mockClear();
  render(<Editable rows={wall()} />);

  fireEvent.click(screen.getByLabelText('on sale'));
  fireEvent.change(screen.getByLabelText('Old price of Stone Mug'), { target: { value: '19' } });
  fireEvent.change(screen.getByLabelText('Price of Stone Mug'), { target: { value: '21' } });
  fireEvent.click(screen.getByText('Save'));

  expect(screen.getByText('The sale price must be lower than the old price')).toBeInTheDocument();
  expect(editProduct).not.toHaveBeenCalled();
});
