import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { formatCostTable, ledgerFromEvents, summariseLedger, type Ledger } from './cost-report';

const sampleLedger = JSON.parse(readFileSync(new URL('../../fixtures/s10/sample-ledger.json', import.meta.url), 'utf8')) as Ledger;
const sampleEvents = readFileSync(new URL('../../fixtures/s10/sample-events.jsonl', import.meta.url), 'utf8');

it('prints the sample ledger in the exact layout', () => {
  expect(formatCostTable(summariseLedger(sampleLedger))).toBe(
    [
      'Cost summary: film f_sample',
      'model                       calls       USD',
      'muse-image-1.0                  7    0.0700',
      'muse-spark-1.3-contributor     12    0.0043',
      'TOTAL                          19    0.0743',
      'Clippy credits: 0',
    ].join('\n'),
  );
});

it('says in the fixture that it is synthetic', () => {
  expect((sampleLedger as unknown as { _comment: string })._comment).toMatch(/SYNTHETIC/);
});

it('sums 0.1 and 0.2 to 0.3000, not 0.30000000000000004', () => {
  const s = summariseLedger({ entries: [{ model: 'm', units: '', usd: 0.1 }, { model: 'm', units: '', usd: 0.2 }] });
  expect(s.totalUsd).toBe(0.3);
  expect(formatCostTable(s)).toContain('0.3000');
});

it('reads the sample events: 4 cost entries, 1 skipped, rows in order', () => {
  const l = ledgerFromEvents(sampleEvents);
  expect(l.entries).toHaveLength(4);
  expect(l.skipped).toBe(1);
  const s = summariseLedger(l);
  expect(s.totalUsd).toBe(0.0225);
  expect(s.calls).toBe(4);
  expect(s.clippyCredits).toBe(25);
  expect(s.rows).toEqual([
    { model: 'muse-image-1.0', calls: 2, usd: 0.02 },
    { model: 'sam-3.1', calls: 1, usd: 0.0025 },
    { model: 'clippy-animate-image', calls: 1, usd: 0 },
  ]);
  expect(l.filmId).toBe('f_sample');
});

it('lets an explicit clippyCredits win over the entries, and sums the entries without it', () => {
  const entries = [{ model: 'clippy', units: '', usd: 0, credits: 25 }, { model: 'clippy', units: '', usd: 0, credits: 25 }];
  expect(summariseLedger({ entries, clippyCredits: 10 }).clippyCredits).toBe(10);
  expect(summariseLedger({ entries }).clippyCredits).toBe(50);
});

it('prints an empty ledger as a TOTAL of 0 calls and 0.0000', () => {
  const text = formatCostTable(summariseLedger({ entries: [] }));
  expect(text).toContain('TOTAL                           0    0.0000');
  expect(text).toContain('Clippy credits: 0');
});

it('skips cost events with a negative or non-numeric usd, and ignores other event types silently', () => {
  const l = ledgerFromEvents(
    [
      '{"type":"cost","model":"a","units":"u","usd":-1}',
      '{"type":"cost","model":"a","units":"u","usd":"0.1"}',
      '{"type":"cost","model":"a","units":"u","usd":0.1,"credits":-5}',
      '{"type":"cost","model":"a","units":"u","usd":0.1}',
      '{"type":"film.status","status":"ready"}',
    ].join('\n'),
  );
  expect(l.entries).toHaveLength(1);
  expect(l.skipped).toBe(3);
});

it('counts a credits-only event as one call of its model with no USD', () => {
  const s = summariseLedger(ledgerFromEvents('{"type":"cost","model":"clippy","units":"1 clip","usd":0,"credits":25}'));
  expect(s).toMatchObject({ calls: 1, totalUsd: 0, clippyCredits: 25 });
});

it('orders rows by USD, then by model name', () => {
  const s = summariseLedger({ entries: [{ model: 'b', units: '', usd: 1 }, { model: 'a', units: '', usd: 1 }, { model: 'c', units: '', usd: 2 }] });
  expect(s.rows.map((r) => r.model)).toEqual(['c', 'a', 'b']);
});
