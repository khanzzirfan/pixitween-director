// Owned by Catalog Crew C1 (US-011). The chips a catalog row wears.
import { expect, it } from 'vitest';
import type { CatalogRow, RowCheck, RowStatus } from '@shared/catalog-run';
import { checkChip, statusChip } from './chips';

const check = (over: Partial<RowCheck> = {}): RowCheck => ({
  ok: true,
  rounds: 1,
  applied: [],
  blocking: [],
  warnings: [],
  ...over,
});

const row = (status: RowStatus, over: Partial<CatalogRow> = {}): CatalogRow => ({
  product: { id: 'can-original', title: 'Sparkling Can', price: 12, currency: 'USD', imageUrl: 'fixtures/can.png', category: 'cans' },
  status,
  clipVersion: 1,
  check: null,
  ...over,
});

it('a fixed row says what the fixer moved', () => {
  const chip = checkChip(
    row('fixed', { check: check({ ok: true, rounds: 2, applied: ['baseY 0.5 -> 0.7347 (the pack hangs above the table)'] }) }),
  );
  expect(chip.tone).toBe('fix');
  expect(chip.text.startsWith('⚑ fixed: baseY 0.5 -> 0.7347')).toBe(true);
  expect(chip.text).toBe('⚑ fixed: baseY 0.5 -> 0.7347 (the pack hangs above the table)');
});

it('a ready row counts the notes it has', () => {
  const chip = checkChip(row('ready', { check: check({ warnings: ['TINY_TEXT caption_price', 'NOT_CONTAINED brand'] }) }));
  expect(chip.tone).toBe('ok');
  expect(chip.text).toBe('✔ checked, 2 notes');
});

it('a flagged row names the finding that still blocks it', () => {
  const chip = checkChip(row('flagged', { check: check({ ok: false, rounds: 2, blocking: ['NOT_CONTAINED caption_price'] }) }));
  expect(chip.tone).toBe('flag');
  expect(chip.text).toBe('⚑ NOT_CONTAINED caption_price');
});

it('a row that was never checked has no check to show', () => {
  const chip = checkChip(row('ready', { check: null }));
  expect(chip.tone).toBe('none');
  expect(chip.text).toBe('not checked (3D)');
});

it('a failed row shows the reason it failed', () => {
  const chip = checkChip(row('failed', { error: 'photo not found: fixtures/nope.png' }));
  expect(chip.tone).toBe('flag');
  expect(chip.text).toBe('photo not found: fixtures/nope.png');
});

it('the status chip is the status word, and it spins while the row is moving', () => {
  expect(statusChip(row('ready'))).toEqual({ text: 'ready', spinning: false });
  expect(statusChip(row('building'))).toEqual({ text: 'building', spinning: true });
  expect(statusChip(row('cutting'))).toEqual({ text: 'cutting', spinning: true });
  expect(statusChip(row('checking'))).toEqual({ text: 'checking', spinning: true });
  expect(statusChip(row('queued')).spinning).toBe(false);
});
