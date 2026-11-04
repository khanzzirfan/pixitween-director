// The line-ups in director.db: one row per line-up, one per product, each state change one transaction.
import { getDb, tx } from '../db/open';
import { LINEUP_ID_RE, lineupSchema, type Lineup, type LineupItem } from '@shared/lineup';

export interface LineupStore {
  create(lineup: Lineup): Promise<Lineup>;
  get(id: string): Promise<Lineup | undefined>;
  /** Replaces one product's state; the rest of the line-up is read fresh so a late write cannot undo another. */
  setItem(id: string, productId: string, patch: Partial<Pick<LineupItem, 'state' | 'error'>>): Promise<Lineup>;
}

export function createLineupStore(o: { dir: string }): LineupStore {
  const db = getDb(o.dir);
  const read = (id: string): Lineup | undefined => {
    if (!LINEUP_ID_RE.test(id)) return undefined;
    const head = db.prepare('SELECT * FROM lineups WHERE id = ?').get(id) as { id: string; aspect: string; brief: string; created_at: string } | undefined;
    if (!head) return undefined;
    const items = db.prepare('SELECT * FROM lineup_items WHERE lineup_id = ? ORDER BY position').all(id) as {
      product_json: string;
      film_id: string | null;
      state: string;
      error: string | null;
    }[];
    return lineupSchema.parse({
      id: head.id,
      aspect: head.aspect,
      brief: head.brief,
      createdAt: head.created_at,
      items: items.map((i) => ({
        product: JSON.parse(i.product_json),
        ...(i.film_id !== null ? { filmId: i.film_id } : {}),
        state: i.state,
        ...(i.error !== null ? { error: i.error } : {}),
      })),
    });
  };
  return {
    async create(raw) {
      const l = lineupSchema.parse(raw);
      tx(db, () => {
        db.prepare('INSERT INTO lineups (id, aspect, brief, created_at) VALUES (?, ?, ?, ?)').run(l.id, l.aspect, l.brief, l.createdAt);
        const ins = db.prepare('INSERT INTO lineup_items (lineup_id, position, product_json, film_id, state, error) VALUES (?, ?, ?, ?, ?, ?)');
        l.items.forEach((i, n) => ins.run(l.id, n, JSON.stringify(i.product), i.filmId ?? null, i.state, i.error ?? null));
      });
      return raw;
    },
    async get(id) {
      return read(id);
    },
    async setItem(id, productId, patch) {
      return tx(db, () => {
        const l = read(id);
        if (!l) throw new Error(`lineup not found: ${id}`);
        const pos = l.items.findIndex((i) => i.product.id === productId);
        if (pos >= 0) {
          const cur = l.items[pos]!;
          const next = { ...cur, ...patch };
          db.prepare('UPDATE lineup_items SET state = ?, error = ? WHERE lineup_id = ? AND position = ?').run(next.state, next.error ?? null, id, pos);
        }
        return read(id)!;
      });
    },
  };
}

/** Line-ups that still have a product waiting or being made: what a restart picks back up. */
export function unfinishedLineupIds(dir: string): string[] {
  return (
    getDb(dir)
      .prepare(
        "SELECT DISTINCT i.lineup_id AS id FROM lineup_items i JOIN lineups l ON l.id = i.lineup_id WHERE i.state IN ('waiting','making') ORDER BY l.created_at, l.id",
      )
      .all() as { id: string }[]
  ).map((r) => r.id);
}
