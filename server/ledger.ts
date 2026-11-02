import { FILM_ID_RE } from '@shared/composition';
import type { Ledger } from '@shared/ports';
import type { EmitInput } from '@shared/tools';
import { getDb } from './db/open';

export interface LedgerOptions {
  dir: string;
  emit(filmId: string, event: EmitInput): unknown;
}

export function createLedger({ dir, emit }: LedgerOptions): Ledger {
  const db = getDb(dir);
  const insert = db.prepare('INSERT INTO ledger (film_id, at, model, units, usd, credits) VALUES (?, ?, ?, ?, ?, ?)');
  const sum = db.prepare('SELECT COALESCE(SUM(usd), 0) AS usd, COALESCE(SUM(credits), 0) AS credits FROM ledger WHERE film_id = ?');
  const check = (filmId: string) => {
    if (!FILM_ID_RE.test(filmId)) throw new Error(`invalid film id '${filmId}'`);
  };
  const totals = (filmId: string) => {
    check(filmId);
    return sum.get(filmId) as { usd: number; credits: number };
  };

  return {
    add(filmId, model, units, usd) {
      check(filmId);
      insert.run(filmId, new Date().toISOString(), model, JSON.stringify(units), usd, 0);
      emit(filmId, { type: 'cost', usd, model, units });
    },
    addCredits(filmId, credits, note) {
      check(filmId);
      insert.run(filmId, new Date().toISOString(), 'clippy', JSON.stringify(note), 0, credits);
      emit(filmId, {
        type: 'cost',
        usd: 0,
        model: 'clippy',
        units: note,
        credits,
      });
    },
    total: (filmId) => totals(filmId).usd,
    credits: (filmId) => totals(filmId).credits,
  };
}
