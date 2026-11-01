// Owned by Catalog Crew C1. The catalog run itself: every product of a feed built in the
// background, one row at a time, so the wall fills while it is watched. One cut-out per
// distinct photo (cached by the photo's hash, so a repeat run spends nothing), one plate per
// look and product class, one clip and one verdict per product, and a running cost.
import { shownPrice, type Product } from '@shared/catalog';
import type { CatalogRow, CatalogRun } from '@shared/catalog-run';
import type { AssetStore } from '@shared/ports';
import { prepareRound } from '../authoring/catalog-clip';
import { LOOKS, pickLook, type ClipLook, type OccasionId } from '../authoring/looks';
import { newPrepareCache, type Prepared3D } from '../product3d/prepare';
import type { CatalogArt } from './art';
import { photoKey, resolvePhoto, type CutoutCache, type CutoutEntry } from './photos';
import { buildRow, loadPlateMap, type RowBuild } from './row';
import type { RowPatch, RunStore } from './run-store';

/** The product class, by category: what SAM cuts out and what the plate's centre must not hold. */
const NOUN: Record<string, string> = { drinks: 'can', home: 'mug' };
/** The colour a photo that carries none of its own falls back to. */
const FALLBACK_ACCENT = '#3d4a5c';
/** A failure's message is cut to this many characters, so a row's error stays readable. */
const ERROR_MAX = 200;

/** A saved plate: the asset and its size. */
export interface PlateRef {
  id: string;
  width: number;
  height: number;
}

/** The plates a run reuses, keyed `<look>:<noun>`. */
export interface PlateStore {
  get(key: string): PlateRef | undefined;
  set(key: string, ref: PlateRef): void;
}

/** What the runner tells the world: one row's new state, or the run's end. */
export type CatalogEvent =
  | { type: 'catalog.row'; catalogId: string; row: CatalogRow }
  | { type: 'catalog.done'; catalogId: string; costUsd: number; ms: number };

export interface RunCatalogOptions {
  /** The run to fill: its rows are the products to build. */
  run: CatalogRun;
  /** Where the run, its clips and its build inputs live. */
  store: RunStore;
  /** The art: a SAM cut-out and a Muse plate, or the free fake. */
  art: CatalogArt;
  /** Where the cut-outs, the plates and the labels are stored. */
  assets: AssetStore;
  /** The photos the owner uploaded, by file name. */
  uploads: Map<string, Buffer>;
  /** The cut-outs already paid for, by the photo's hash. */
  cutCache: CutoutCache;
  /** The plates already painted, by `<look>:<noun>`. */
  plates: PlateStore;
  /** Where the wall hears about it. */
  emit: (event: CatalogEvent) => void;
  /** The clock, for a row's and the run's milliseconds. */
  now?: () => number;
}

/** The product class of a product: its category's, or 'product'. */
const nounOf = (p: Product): string => NOUN[p.category] ?? 'product';

/** A plate's key: the look and the product class it was painted for. */
const plateKey = (look: string, noun: string): string => `${look}:${noun}`;

/**
 * The plate for a look and a product class: the one painted for that pair, or the bare look
 * when it was painted for cans (the plates s18 left behind carry only the look).
 */
function findPlate(plates: PlateStore, look: string, noun: string): PlateRef | undefined {
  return plates.get(plateKey(look, noun)) ?? (noun === 'can' ? plates.get(look) : undefined);
}

/** The message of a throw, as a row can carry it. */
function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Builds every product of the run, one row at a time, and tells the wall as it goes.
 *
 * The order is the one s19-catalog used: the photo is cut out once per distinct picture, the
 * tall round pack gets its wrapped label, a look is picked per product, a plate is painted per
 * look that has none, and the clip is built and checked. A row that cannot make it — a photo
 * that is not there, a build that throws — ends `failed` with the reason, and the run goes on
 * with the next row.
 */
export async function runCatalog(o: RunCatalogOptions): Promise<void> {
  const { run, store, art, assets, uploads, cutCache, plates, emit } = o;
  const now = o.now ?? (() => Date.now());
  const started = now();
  let cost = 0;

  const prep3d = newPrepareCache();
  /** The cut-outs of this run, by the photo's hash. */
  const cuts = new Map<string, CutoutEntry>();
  /** The wrapped label of each photo, when it has one. */
  const rounds = new Map<string, Prepared3D | undefined>();

  /** Saves the row and tells the wall about it. */
  const say = async (productId: string, patch: RowPatch): Promise<CatalogRow> => {
    const row = await store.updateRow(run.id, productId, patch);
    emit({ type: 'catalog.row', catalogId: run.id, row });
    return row;
  };

  /**
   * The plate for a look and a product class: the one already painted, or a new one. A look
   * that draws its own world (the 3D hero, the price promo) has no plate at all.
   */
  const plateFor = async (look: ClipLook, occasion: OccasionId, noun: string): Promise<PlateRef | undefined> => {
    if (look === 'hero-3d') return undefined;
    if (LOOKS[look].plate === null) return undefined;
    const found = findPlate(plates, look, noun);
    if (found) return found;
    const made = await art.plate(look, occasion, noun, run.aspect);
    cost += made.usd;
    const ref: PlateRef = { id: made.id, width: made.width, height: made.height };
    plates.set(plateKey(look, noun), ref);
    return ref;
  };

  for (const { product } of run.rows) {
    const rowStarted = now();
    try {
      await say(product.id, { status: 'cutting' });

      const photo = resolvePhoto(product.imageUrl, uploads);
      if ('error' in photo) {
        await say(product.id, { status: 'failed', error: photo.error.slice(0, ERROR_MAX) });
        continue;
      }

      const key = photoKey(photo);
      let cut = cuts.get(key);
      if (!cut) {
        const cached = await cutCache.get(key);
        if (cached) {
          cut = cached;
        } else {
          const made = await art.cut(photo, nounOf(product));
          cost += made.usd;
          cut = { id: made.id, width: made.width, height: made.height, accent: made.accent, chroma: made.chroma };
          await cutCache.set(key, cut);
        }
        cuts.set(key, cut);
        rounds.set(key, await prepareRound(assets, cut, nounOf(product), prep3d));
      }

      await say(product.id, { status: 'building' });

      const noun = nounOf(product);
      const prepared = rounds.get(key);
      const pick = pickLook({
        title: product.title,
        category: product.category,
        width: cut.width,
        height: cut.height,
        onSale: product.salePrice !== undefined,
        round: prepared !== undefined,
      });
      const plate = await plateFor(pick.look, pick.occasion, noun);
      const accent = cut.chroma > 0.05 ? cut.accent : FALLBACK_ACCENT;

      const build: RowBuild = {
        aspect: run.aspect,
        look: pick.look,
        ...(prepared ? { prepared } : {}),
        ...(plate ? { plate: { id: plate.id, src: `/api/assets/${plate.id}`, width: plate.width, height: plate.height } } : {}),
        ...(plate ? { plateMap: loadPlateMap(plate.id) } : {}),
        product: { id: cut.id, src: `/api/assets/${cut.id}`, width: cut.width, height: cut.height },
        title: product.title,
        price: shownPrice(product),
        ...(product.salePrice !== undefined ? { wasPrice: product.price } : {}),
        currency: product.currency,
        ...(product.brand ? { brand: product.brand } : {}),
        accent,
      };

      await say(product.id, { status: 'checking' });

      const result = buildRow(build);
      await store.saveClip(run.id, product.id, result.comp);
      await store.saveBuild(run.id, product.id, result.build);
      await say(product.id, {
        status: result.status,
        check: result.check,
        look: pick.look,
        why: pick.why,
        accent,
        ms: now() - rowStarted,
      });
    } catch (e) {
      await say(product.id, { status: 'failed', error: message(e).slice(0, ERROR_MAX) });
    }
  }

  await store.setRun(run.id, { state: 'done', costUsd: cost });
  emit({ type: 'catalog.done', catalogId: run.id, costUsd: cost, ms: now() - started });
}
