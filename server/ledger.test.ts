import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import type { EmitInput } from '@shared/tools';
import { createLedger } from './ledger';

const F = 'film_aaaaaaaaaaaa';
const setup = (dir = mkdtempSync(join(tmpdir(), 'ledger-'))) => {
  const events: EmitInput[] = [];
  return { dir, events, ledger: createLedger({ dir, emit: (_id, e) => events.push(e) }) };
};

it('accumulates usd', () => {
  const { ledger } = setup();
  ledger.add(F, 'muse-image', '1 image', 0.01);
  ledger.add(F, 'muse-image', '1 image', 0.01);
  ledger.add(F, 'sam', '1 image', 0.0025);
  expect(ledger.total(F)).toBeCloseTo(0.0225, 9);
});

it('credits do not change usd', () => {
  const { ledger } = setup();
  ledger.add(F, 'm', 'u', 0.5);
  ledger.addCredits(F, 25, 'animate fast-h3');
  ledger.addCredits(F, 25, 'retry');
  expect(ledger.credits(F)).toBe(50);
  expect(ledger.total(F)).toBe(0.5);
});

it('a new ledger over the same dir reads the previous totals', () => {
  const a = setup();
  a.ledger.add(F, 'm', 'u', 0.25);
  a.ledger.addCredits(F, 25, 'x');
  const b = setup(a.dir);
  expect(b.ledger.total(F)).toBe(0.25);
  expect(b.ledger.credits(F)).toBe(25);
});

it('emits one cost event per call, with credits only for addCredits', () => {
  const { ledger, events } = setup();
  ledger.add(F, 'm', 'u', 0.1);
  ledger.addCredits(F, 25, 'note');
  expect(events).toEqual([
    { type: 'cost', usd: 0.1, model: 'm', units: 'u' },
    { type: 'cost', usd: 0, model: 'clippy', units: 'note', credits: 25 },
  ]);
});

it('refuses a malformed film id', () => {
  expect(() => setup().ledger.add('../x', 'm', 'u', 1)).toThrow();
});
