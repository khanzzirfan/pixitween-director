// Owned by Catalog Crew C1. The catalog routes: start a run from a CSV or the demo feed, read
// the run's rows, list the runs and hand a clip back. The run itself is `server/catalog/runner.ts`;
// this file is the wiring between the studio and that runner, so the UI never needs the CLI.
import { readFileSync, writeFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import type { Hono } from 'hono';
import { z } from 'zod';
import { parseFeed, shownPrice, type Product } from '@shared/catalog';
import { isFinal, newCatalogId, summarize, type CatalogRun } from '@shared/catalog-run';
import type { Aspect } from '@shared/composition';
import type { ToolCtx } from '@shared/tools';
import { LOOKS, type ClipLook } from '../../authoring/looks';
import { fakeArt, realArt, type CatalogArt } from '../../catalog/art';
import { createCutoutCache, createMemoryCutoutCache } from '../../catalog/photos';
import { buildRow, type RowBuild } from '../../catalog/row';
import { buildLineFilms } from '../../catalog/line-film';
import { createRunStore, type RunStore } from '../../catalog/run-store';
import { runCatalog, type PlateRef, type PlateStore } from '../../catalog/runner';
import { loadEnv } from '../../env';
import type { AppDeps } from '../deps';

/** The feed the studio can start a run from without a file of its own. */
const DEMO_FEED = 'fixtures/catalog/feed-6.csv';
/** The plates s18 painted, keyed by the look. A run reuses them and writes the new ones back. */
const PLATES_FILE = 'web/public/cartoon/look-plates.json';
/** A run may not carry more products than this. */
const MAX_PRODUCTS = 50;
/** The aspects a catalog may be cut for. */
const ASPECTS: readonly Aspect[] = ['9:16', '16:9', '1:1'];

const notFound = { error: 'not_found' } as const;
/** Why a row that was still moving when the server stopped ends failed. */
const STOPPED = 'stopped: the server restarted before this row was built';

/**
 * What a price edit may change: the price, the sale price (null takes the sale off) or the title.
 * The numbers are the product's own two prices: on sale the sale price is the one the ad shows and
 * the price is the one it was.
 */
const editSchema = z.object({
  price: z.number().nonnegative().optional(),
  salePrice: z.number().nonnegative().nullable().optional(),
  title: z.string().min(1).max(120).optional(),
});
type Edit = z.infer<typeof editSchema>;

/** The looks a clip may be built for: the six of the table and the 3D hero. */
const isClipLook = (value: unknown): value is ClipLook =>
  value === 'hero-3d' || (typeof value === 'string' && Object.hasOwn(LOOKS, value));

/**
 * The parts of a stored build a rebuild needs. The rest (the prepared label, the plate, the plate's
 * read, the base line the fixer chose) is carried over as it is, so the guard asks only for what the
 * rebuild reads and a build that cannot be rebuilt is refused instead of half-used.
 */
const storedBuildSchema = z.object({
  aspect: z.enum(['9:16', '16:9', '1:1']),
  look: z.string().refine(isClipLook),
  product: z.object({ id: z.string(), src: z.string(), width: z.number(), height: z.number() }),
  accent: z.string(),
});

/**
 * The product after the edit: a null sale price takes the sale off, a field that was not sent keeps
 * what it was.
 */
function applyEdit(product: Product, edit: Edit): Product {
  const next: Product = { ...product };
  if (edit.price !== undefined) next.price = edit.price;
  if (edit.title !== undefined) next.title = edit.title;
  if (edit.salePrice === null) delete next.salePrice;
  else if (edit.salePrice !== undefined) next.salePrice = edit.salePrice;
  return next;
}

export interface CatalogRoutesOptions {
  /** The art a run uses. Default: the free fake under DIRECTOR_FAKE=1, else the real one. */
  art?: (ctx: ToolCtx) => CatalogArt;
  /** Where the plates live. Defaults to the file s18 painted. */
  platesFile?: string;
}

/** What a plate file holds: the asset and its size, plus whatever the look needed. */
interface PlateFileEntry {
  id: string;
  width: number;
  height: number;
}

/**
 * The plates of a file, keyed the way the runner asks for them (`<look>:<noun>`). The plates s18
 * left behind are keyed by the look alone and were made for cans, so a can finds its plate
 * through the runner's own fallback. A new plate is written back under the key it was asked for.
 */
function createPlateStore(file: string): PlateStore {
  const read = (): Record<string, PlateFileEntry> => {
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as unknown;
      return typeof raw === 'object' && raw !== null ? (raw as Record<string, PlateFileEntry>) : {};
    } catch {
      return {};
    }
  };
  return {
    get(key) {
      const entry = read()[key];
      if (!entry || typeof entry.id !== 'string') return undefined;
      return { id: entry.id, width: entry.width ?? 0, height: entry.height ?? 0 };
    },
    set(key, ref) {
      const all = read();
      all[key] = { ...all[key], id: ref.id, width: ref.width, height: ref.height };
      writeFileSync(file, `${JSON.stringify(all, null, 2)}\n`);
    },
  };
}

const isFile = (value: unknown): value is File => typeof File !== 'undefined' && value instanceof File;

export function registerCatalogRoutes(app: Hono, deps: AppDeps, opts: CatalogRoutesOptions = {}): void {
  // One store for the app: its promise-chain mutex serialises the writes of a run against the
  // reads of the wall, so a reader never sees a half-written run.
  let store: RunStore | undefined;
  const dataDir = (): string => deps.dataDir ?? loadEnv().DATA_DIR;
  const runs = (): RunStore => (store ??= createRunStore({ dir: dataDir() }));
  /** The runs this process is building. A run that says `running` and is not here lost its runner. */
  const active = new Set<string>();

  /**
   * A run whose runner is gone (the server restarted mid-run) would say `running` forever and its
   * wall would never finish. It is settled the first time it is read: the rows that were still
   * moving end `failed` with the reason, and the run ends `done`.
   */
  async function settle(run: CatalogRun): Promise<CatalogRun> {
    if (run.state !== 'running' || active.has(run.id)) return run;
    for (const row of run.rows) {
      if (!isFinal(row.status)) await runs().updateRow(run.id, row.product.id, { status: 'failed', error: STOPPED });
    }
    return runs().setRun(run.id, { state: 'done' });
  }

  app.post('/api/catalogs', async (c) => {
    const form = await c.req.formData().catch(() => undefined);
    if (!form) return c.json({ error: 'bad_request', message: 'Send the feed as multipart/form-data.' }, 400);

    const demo = form.get('demo');
    const csv = form.get('csv');
    let feed: string | undefined;
    if (typeof demo === 'string' && demo) {
      if (demo !== 'feed-6') return c.json({ error: 'bad_demo', message: `unknown demo feed: ${demo}` }, 400);
      feed = readFileSync(DEMO_FEED, 'utf8');
    } else if (isFile(csv)) {
      feed = await csv.text();
    } else if (typeof csv === 'string') {
      feed = csv;
    }
    if (feed === undefined) return c.json({ error: 'feed_required', message: 'Send a CSV file, or the demo feed.' }, 400);

    const parsed = parseFeed(feed);
    if (!parsed.ok) return c.json({ error: 'bad_feed', errors: parsed.errors }, 400);
    const products = parsed.products;
    if (products.length > MAX_PRODUCTS) return c.json({ error: 'too_many_products', max: MAX_PRODUCTS }, 400);

    const wanted = form.get('aspect');
    const aspect = wanted === null || wanted === '' ? '9:16' : String(wanted);
    if (!ASPECTS.includes(aspect as Aspect)) return c.json({ error: 'bad_aspect' }, 400);

    const fake = process.env.DIRECTOR_FAKE === '1';
    if (!opts.art && !fake && !loadEnv().metaApiKey) return c.json({ error: 'meta_key_missing' }, 503);

    // The carrier film: it carries the run's ctx (the cut-out and the plate need one), its cost
    // ledger and its event log, so the studio watches the run through the film's own SSE.
    const film = await deps.films.create({
      aspect: aspect as Aspect,
      title: `Catalog: ${products.length} products`,
      brief: { text: 'Catalog run', productAssetId: '' },
      assets: [],
    });
    const ctx = deps.makeToolCtx(film.id);
    const run = await runs().create({
      id: newCatalogId(),
      filmId: film.id,
      aspect: aspect as Aspect,
      createdAt: new Date().toISOString(),
      state: 'running',
      costUsd: 0,
      rows: products.map((product) => ({ product, status: 'queued' })),
    });
    active.add(run.id);

    const uploads = new Map<string, Buffer>();
    for (const photo of form.getAll('photos')) {
      if (isFile(photo)) uploads.set(photo.name, Buffer.from(await photo.arrayBuffer()));
    }

    const art = opts.art ? opts.art(ctx) : fake ? fakeArt(deps.assets) : realArt(ctx, deps.assets);
    // The fake paints its plates in memory, so a test or an e2e run never writes a fake plate
    // id into the file the real runs share.
    const plates: PlateStore = fake ? new Map<string, PlateRef>() : createPlateStore(opts.platesFile ?? PLATES_FILE);

    // The run goes on in the background: the wall watches the rows arrive one by one.
    void runCatalog({
      run,
      store: runs(),
      art,
      assets: deps.assets,
      uploads,
      cutCache: fake ? createMemoryCutoutCache() : createCutoutCache(dataDir()),
      plates,
      emit: (event) => ctx.emit(event),
    })
      .catch((err: unknown) => console.error(`catalog run ${run.id} failed:`, err))
      .finally(() => active.delete(run.id));

    return c.json({ catalogId: run.id, filmId: film.id }, 202);
  });

  app.get('/api/catalogs', async (c) => {
    const list = await Promise.all((await runs().list()).map(settle));
    return c.json({
      runs: list.map((run) => {
        const summary = summarize(run.rows);
        return {
          id: run.id,
          filmId: run.filmId,
          createdAt: run.createdAt,
          state: run.state,
          total: summary.total,
          final: summary.final,
        };
      }),
    });
  });

  app.get('/api/catalogs/:id', async (c) => {
    const run = await runs().get(c.req.param('id'));
    if (!run) return c.json(notFound, 404);
    return c.json(await settle(run));
  });

  app.get('/api/catalogs/:id/films/:lineId', async (c) => {
    const film = await runs().readFilm(c.req.param('id'), c.req.param('lineId')).catch(() => undefined);
    if (!film) return c.json(notFound, 404);
    return c.json(film);
  });

  app.get('/api/catalogs/:id/clips/:productId', async (c) => {
    const clip = await runs().readClip(c.req.param('id'), c.req.param('productId')).catch(() => undefined);
    if (!clip) return c.json(notFound, 404);
    return c.json(clip);
  });

  // A price edit: the clip is rebuilt from what the run already paid for, so it costs nothing and
  // takes about a second. No cut-out, no plate, no model.
  app.patch('/api/catalogs/:id/products/:productId', async (c) => {
    const raw = await c.req.json().catch(() => undefined);
    const parsed = editSchema.safeParse(raw);
    if (!parsed.success) return c.json({ error: 'bad_edit' }, 400);
    const edit = parsed.data;

    const id = c.req.param('id');
    const productId = c.req.param('productId');
    const run = await runs().get(id);
    if (!run) return c.json(notFound, 404);
    const row = run.rows.find((r) => r.product.id === productId);
    if (!row) return c.json(notFound, 404);
    // A row that is still building has no clip to change, and a failed one has nothing to rebuild from.
    if (!isFinal(row.status) || row.status === 'failed') return c.json({ error: 'not_ready' }, 409);

    // The build is what the clip is rebuilt from: the cut-out, the plate and the copy. It comes off
    // the disk, so it is checked before it is trusted.
    const stored = await runs().readBuild(id, productId).catch(() => undefined);
    const guard = storedBuildSchema.safeParse(stored);
    if (!guard.success) return c.json({ error: 'not_ready' }, 409);

    const product = applyEdit(row.product, edit);
    // A sale price at or above the price it was is not a sale: the ad would strike through a lower number.
    if (product.salePrice !== undefined && product.salePrice >= product.price) return c.json({ error: 'bad_edit', message: 'The sale price must be lower than the price.' }, 400);
    const build: RowBuild = {
      ...(stored as RowBuild),
      look: guard.data.look,
      title: product.title,
      price: shownPrice(product),
      wasPrice: product.salePrice !== undefined ? product.price : undefined,
    };

    const started = performance.now();
    let result: ReturnType<typeof buildRow>;
    try {
      result = buildRow(build);
    } catch (err) {
      console.error(`catalog ${id} row ${productId} could not be rebuilt:`, err);
      return c.json({ error: 'not_ready' }, 409);
    }
    await runs().saveClip(id, productId, result.comp);
    await runs().saveBuild(id, productId, result.build);
    const updated = await runs().updateRow(id, productId, {
      product,
      status: result.status,
      check: result.check,
      ms: Math.round(performance.now() - started),
    });
    // The line films that show this product carry its price too, so they are cut again (free, from the stored builds).
    const after = await runs().get(id);
    if (after?.films?.some((f) => f.productIds.includes(productId))) {
      try {
        await runs().setRun(id, { films: await buildLineFilms(after, runs()) });
      } catch (err) {
        console.error(`catalog ${id}: the line films could not be rebuilt after the edit:`, err);
      }
    }
    // The wall hears about the new row the same way the runner told it about the old one.
    deps.makeToolCtx(run.filmId).emit({ type: 'catalog.row', catalogId: id, row: updated });
    return c.json({ row: updated }, 200);
  });
}
