// The line-ups on disk: one small JSON file each, written whole. Reads and writes of one line-up never overlap.
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { LINEUP_ID_RE, lineupSchema, type Lineup, type LineupItem } from '@shared/lineup';

export interface LineupStore {
  create(lineup: Lineup): Promise<Lineup>;
  get(id: string): Promise<Lineup | undefined>;
  /** Replaces one product's state; the rest of the line-up is read fresh so a late write cannot undo another. */
  setItem(id: string, productId: string, patch: Partial<Pick<LineupItem, 'state' | 'error'>>): Promise<Lineup>;
}

export function createLineupStore(o: { dir: string }): LineupStore {
  const root = join(o.dir, 'lineups');
  const file = (id: string) => join(root, `${id}.json`);
  const tails = new Map<string, Promise<unknown>>();
  const locked = <T>(id: string, fn: () => Promise<T>): Promise<T> => {
    const run = (tails.get(id) ?? Promise.resolve()).then(fn, fn);
    tails.set(id, run.catch(() => undefined));
    return run;
  };
  const read = async (id: string): Promise<Lineup | undefined> => {
    if (!LINEUP_ID_RE.test(id)) return undefined;
    try {
      return lineupSchema.parse(JSON.parse(await readFile(file(id), 'utf8')));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw e;
    }
  };
  const write = async (l: Lineup) => {
    await mkdir(root, { recursive: true });
    const tmp = `${file(l.id)}.tmp`;
    await writeFile(tmp, JSON.stringify(l));
    await rename(tmp, file(l.id));
  };
  return {
    create: (l) => locked(l.id, async () => (await write(lineupSchema.parse(l)), l)),
    get: (id) => locked(id, () => read(id)),
    setItem: (id, productId, patch) =>
      locked(id, async () => {
        const l = await read(id);
        if (!l) throw new Error(`lineup not found: ${id}`);
        const next = { ...l, items: l.items.map((i) => (i.product.id === productId ? { ...i, ...patch } : i)) };
        await write(next);
        return next;
      }),
  };
}

export async function listLineupIds(dir: string): Promise<string[]> {
  return (await readdir(join(dir, 'lineups')).catch(() => [] as string[])).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
}
