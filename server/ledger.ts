import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FILM_ID_RE } from '@shared/composition';
import type { Ledger } from '@shared/ports';
import type { EmitInput } from '@shared/tools';

export interface LedgerOptions {
  dir: string;
  emit(filmId: string, event: EmitInput): unknown;
}

interface Totals {
  usd: number;
  credits: number;
}

export function createLedger({ dir, emit }: LedgerOptions): Ledger {
  const totals = new Map<string, Totals>();
  const file = (filmId: string) => {
    if (!FILM_ID_RE.test(filmId)) throw new Error(`invalid film id '${filmId}'`);
    return join(dir, 'films', filmId, 'ledger.jsonl');
  };

  const load = (filmId: string): Totals => {
    let t = totals.get(filmId);
    if (t) return t;
    t = { usd: 0, credits: 0 };
    try {
      for (const line of readFileSync(file(filmId), 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try {
          const row = JSON.parse(line) as { usd?: number; credits?: number };
          t.usd += row.usd ?? 0;
          t.credits += row.credits ?? 0;
        } catch {
          // truncated final line
        }
      }
    } catch {
      // no ledger yet
    }
    totals.set(filmId, t);
    return t;
  };

  const append = (filmId: string, row: object) => {
    const f = file(filmId);
    mkdirSync(join(dir, 'films', filmId), { recursive: true });
    appendFileSync(f, JSON.stringify(row) + '\n');
  };

  return {
    add(filmId, model, units, usd) {
      const t = load(filmId);
      append(filmId, { at: new Date().toISOString(), model, units, usd });
      t.usd += usd;
      emit(filmId, { type: 'cost', usd, model, units });
    },
    addCredits(filmId, credits, note) {
      const t = load(filmId);
      append(filmId, { at: new Date().toISOString(), model: 'clippy', units: note, usd: 0, credits });
      t.credits += credits;
      emit(filmId, { type: 'cost', usd: 0, model: 'clippy', units: note, credits });
    },
    total: (filmId) => load(filmId).usd,
    credits: (filmId) => load(filmId).credits,
  };
}
