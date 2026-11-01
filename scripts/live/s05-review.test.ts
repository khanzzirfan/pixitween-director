import { expect, it, vi } from 'vitest';
import { loadEnv } from '../../server/env';
import * as live from './s05-review';

it('says what it does and what it costs', () => {
  expect(live.describe()).toContain('4 synthetic frames');
  expect(live.describe()).toContain('debug/s05');
  expect(live.estimateUsd()).toBe(0.05);
});

it('refuses to start without a Meta key, before any network call', async () => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no network in tests'));
  await expect(live.run({ env: loadEnv({}), log: () => undefined })).rejects.toThrow(/META_API_KEY/);
  expect(fetchSpy).not.toHaveBeenCalled();
  fetchSpy.mockRestore();
});

it('renders a header and one row per frame', () => {
  const rows: live.ReportRow[] = [
    { name: 'clean', expected: [], grounded: [], dropped: 0, ok: true },
    { name: 'text-over-product', expected: ['text-over-product'], grounded: ['text-over-product'], dropped: 1, ok: true },
    { name: 'low-contrast', expected: ['low-contrast'], grounded: [], dropped: 0, ok: false },
    { name: 'product-missing', expected: ['product-hidden'], grounded: [], dropped: 0, ok: false, error: 'spark failed' },
  ];
  const lines = live.formatReport(rows).split('\n');
  expect(lines).toHaveLength(6);
  expect(lines[2]).toContain('none');
  expect(lines[4]).toContain('FAIL');
  expect(lines[5]).toContain('error: spark failed');
});

it('compares grounded kinds with the expected ones exactly', () => {
  expect(live.rowOk([], [])).toBe(true);
  expect(live.rowOk(['low-contrast'], ['low-contrast'])).toBe(true);
  expect(live.rowOk(['low-contrast'], [])).toBe(false);
  expect(live.rowOk([], ['artefact'])).toBe(false);
  expect(live.rowOk(['low-contrast'], ['low-contrast', 'artefact'])).toBe(false);
});
