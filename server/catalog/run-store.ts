// Owned by Catalog Crew C1. The catalog runs on disk: the run, its clips and its build inputs.
// Every write is atomic (write a .tmp file, then rename) and serialised per run, so the wall
// survives a reload and a price edit can rebuild a clip from the stored build input.
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { z } from 'zod';
import type { AepCompositionJson } from '@shared/aep';
import { CATALOG_ID_RE, LINE_ID_RE, catalogRowSchema, catalogRunSchema, type CatalogRow, type CatalogRun } from '@shared/catalog-run';

/** A product id becomes a file name, so it may not point out of the run's own folder. */
export const PRODUCT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** What `create` accepts: the row fields that have a default may be left out. */
type RunInput = z.input<typeof catalogRunSchema>;
type RowInput = z.input<typeof catalogRowSchema>;

/** A row patch: plain fields, or a function of the row as it is now (for a read-modify-write). */
export type RowPatch = Partial<RowInput> | ((row: CatalogRow) => Partial<RowInput>);

export interface RunStoreOptions {
  /** The data dir. The runs live in `<dir>/catalogs`. */
  dir: string;
}

export interface RunStore {
  create(run: RunInput): Promise<CatalogRun>;
  get(id: string): Promise<CatalogRun | undefined>;
  list(): Promise<CatalogRun[]>;
  updateRow(id: string, productId: string, patch: RowPatch): Promise<CatalogRow>;
  setRun(id: string, patch: Partial<Pick<CatalogRun, 'state' | 'costUsd' | 'films'>>): Promise<CatalogRun>;
  saveClip(id: string, productId: string, comp: AepCompositionJson): Promise<CatalogRow>;
  readClip(id: string, productId: string): Promise<AepCompositionJson | undefined>;
  saveBuild(id: string, productId: string, input: unknown): Promise<void>;
  readBuild<T = unknown>(id: string, productId: string): Promise<T | undefined>;
  saveFilm(id: string, lineId: string, comp: AepCompositionJson): Promise<void>;
  readFilm(id: string, lineId: string): Promise<AepCompositionJson | undefined>;
}

export function createRunStore({ dir }: RunStoreOptions): RunStore {
  const root = join(dir, 'catalogs');
  const chains = new Map<string, Promise<void>>();

  const runDir = (id: string) => {
    if (!CATALOG_ID_RE.test(id)) throw new RangeError(`not a catalog id: ${id}`);
    return join(root, id);
  };
  const runFile = (id: string) => join(runDir(id), 'run.json');
  const productFile = (id: string, productId: string, folder: 'clips' | 'build' | 'films') => {
    if (!PRODUCT_ID_RE.test(productId)) throw new RangeError(`not a product id: ${productId}`);
    return join(runDir(id), folder, `${productId}.json`);
  };

  /** Serialise every operation on one run (promise-chain mutex): two updates never lose one. */
  function locked<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prev = chains.get(id) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    chains.set(id, run.then(() => undefined, () => undefined));
    return run;
  }

  async function writeJson(file: string, data: unknown) {
    await mkdir(dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    await writeFile(tmp, JSON.stringify(data));
    await rename(tmp, file);
  }

  async function readJson<T>(file: string): Promise<T | undefined> {
    try {
      return JSON.parse(await readFile(file, 'utf8')) as T;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw e;
    }
  }

  async function readRun(id: string): Promise<CatalogRun> {
    const raw = await readJson<unknown>(runFile(id));
    if (raw === undefined) throw new Error(`catalog run not found: ${id}`);
    return catalogRunSchema.parse(raw);
  }

  /** The patched row and the rows of the run it belongs to. Throws when the row is not there. */
  function mergeRow(run: CatalogRun, productId: string, patch: RowPatch): { rows: CatalogRow[]; row: CatalogRow } {
    const at = run.rows.findIndex((r) => r.product.id === productId);
    if (at < 0) throw new Error(`catalog row not found: ${productId}`);
    const current = run.rows[at]!;
    const raw = typeof patch === 'function' ? patch(current) : patch;
    const clean = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined)) as Partial<RowInput>;
    const row = catalogRowSchema.parse({ ...current, ...clean });
    const rows = [...run.rows];
    rows[at] = row;
    return { rows, row };
  }

  const create = async (run: RunInput): Promise<CatalogRun> => {
    const parsed = catalogRunSchema.parse(run);
    return locked(parsed.id, async () => {
      const file = runFile(parsed.id);
      await mkdir(dirname(file), { recursive: true });
      try {
        await writeFile(file, JSON.stringify(parsed), { flag: 'wx' });
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`catalog run already exists: ${parsed.id}`);
        throw e;
      }
      return parsed;
    });
  };

  const get = async (id: string): Promise<CatalogRun | undefined> => {
    if (!CATALOG_ID_RE.test(id)) return undefined;
    return locked(id, async () => {
      const raw = await readJson<unknown>(runFile(id));
      return raw === undefined ? undefined : catalogRunSchema.parse(raw);
    });
  };

  const list = async (): Promise<CatalogRun[]> => {
    const ids = await readdir(root).catch(() => [] as string[]);
    const runs = await Promise.all(ids.filter((i) => CATALOG_ID_RE.test(i)).map((i) => get(i).catch(() => undefined)));
    return runs.filter((r): r is CatalogRun => !!r).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  };

  const updateRow = async (id: string, productId: string, patch: RowPatch): Promise<CatalogRow> => {
    if (!PRODUCT_ID_RE.test(productId)) throw new RangeError(`not a product id: ${productId}`);
    return locked(id, async () => {
      const run = await readRun(id);
      const { rows, row } = mergeRow(run, productId, patch);
      await writeJson(runFile(id), { ...run, rows });
      return row;
    });
  };

  const setRun = async (id: string, patch: Partial<Pick<CatalogRun, 'state' | 'costUsd' | 'films'>>): Promise<CatalogRun> => {
    return locked(id, async () => {
      const run = await readRun(id);
      const next = catalogRunSchema.parse({ ...run, ...patch });
      await writeJson(runFile(id), next);
      return next;
    });
  };

  const saveClip = async (id: string, productId: string, comp: AepCompositionJson): Promise<CatalogRow> => {
    if (!PRODUCT_ID_RE.test(productId)) throw new RangeError(`not a product id: ${productId}`);
    return locked(id, async () => {
      const run = await readRun(id);
      const { rows, row } = mergeRow(run, productId, (r) => ({ clipVersion: r.clipVersion + 1 }));
      await writeJson(productFile(id, productId, 'clips'), comp);
      await writeJson(runFile(id), { ...run, rows });
      return row;
    });
  };

  const readClip = async (id: string, productId: string): Promise<AepCompositionJson | undefined> => {
    if (!PRODUCT_ID_RE.test(productId)) throw new RangeError(`not a product id: ${productId}`);
    return locked(id, () => readJson<AepCompositionJson>(productFile(id, productId, 'clips')));
  };

  const saveBuild = async (id: string, productId: string, input: unknown): Promise<void> => {
    if (!PRODUCT_ID_RE.test(productId)) throw new RangeError(`not a product id: ${productId}`);
    return locked(id, async () => {
      await writeJson(productFile(id, productId, 'build'), input);
    });
  };

  const readBuild = async <T = unknown>(id: string, productId: string): Promise<T | undefined> => {
    if (!PRODUCT_ID_RE.test(productId)) throw new RangeError(`not a product id: ${productId}`);
    return locked(id, () => readJson<T>(productFile(id, productId, 'build')));
  };

  const saveFilm = async (id: string, lineId: string, comp: AepCompositionJson): Promise<void> => {
    if (!LINE_ID_RE.test(lineId)) throw new RangeError(`not a line id: ${lineId}`);
    return locked(id, () => writeJson(productFile(id, lineId, 'films'), comp));
  };

  const readFilm = async (id: string, lineId: string): Promise<AepCompositionJson | undefined> => {
    if (!LINE_ID_RE.test(lineId)) throw new RangeError(`not a line id: ${lineId}`);
    return locked(id, () => readJson<AepCompositionJson>(productFile(id, lineId, 'films')));
  };

  return { create, get, list, updateRow, setRun, saveClip, readClip, saveBuild, readBuild, saveFilm, readFilm };
}
