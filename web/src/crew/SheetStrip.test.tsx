import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import type { AssetRef } from '@shared/composition';
import { SheetStrip } from './SheetStrip';

const asset = (id: string, role: AssetRef['role']): AssetRef => ({ id, url: `/api/assets/${id}`, mime: 'image/jpeg', role });
const assets = [asset('a1', 'sheet'), asset('p1', 'plate'), asset('a2', 'sheet')];

it('shows exactly the sheets as thumbnails', () => {
  render(<SheetStrip assets={assets} />);
  expect(screen.getAllByRole('img')).toHaveLength(2);
});

it('opens one large on a click and closes on Escape or a click outside', () => {
  render(<SheetStrip assets={assets} />);
  fireEvent.click(screen.getAllByRole('button')[1]!);
  expect(screen.getByTestId('sheet-overlay').querySelector('img')).toHaveAttribute('src', '/api/assets/a2');
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByTestId('sheet-overlay')).toBeNull();
  fireEvent.click(screen.getAllByRole('button')[0]!);
  fireEvent.click(screen.getByTestId('sheet-overlay'));
  expect(screen.queryByTestId('sheet-overlay')).toBeNull();
});

it('renders nothing without sheets', () => {
  const { container } = render(<SheetStrip assets={[asset('p1', 'plate')]} />);
  expect(container).toBeEmptyDOMElement();
});

it('shows a sheet that comes from the film and from its event once', () => {
  render(<SheetStrip assets={[...assets, asset('a2', 'sheet')]} />);
  expect(screen.getAllByRole('img')).toHaveLength(2);
});
