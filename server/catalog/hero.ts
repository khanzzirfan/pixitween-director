// Owned by Catalog Crew C1. A product's hero film: its board (Muse's idea and shot list, or the floor board) played in one 3D world
// with a real camera (server/authoring/cinematic-film.ts). A round pack wears its unwrapped label; every other product is its own
// cut-out, extruded into a thick standee. If the 3D film cannot be built the 2D board film stands in, so a row always has one.
// Pure: the board is in the row's build, so a price edit cuts the film again at $0.
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { shownPrice, type Product } from '@shared/catalog';
import { readStoredBoard, type CinematicBoard } from '../authoring/beatsheet';
import { buildBoardClip } from '../authoring/board-clip';
import { floorCatalogBoard } from '../authoring/catalog-board';
import { ASPECT_SIZES, type Aspect } from '@shared/composition';
import type { AssetStore } from '@shared/ports';
import { groundColor, renderBackdrop, renderDot } from '../authoring/set-art';
import { buildCinematicFilm } from '../authoring/cinematic-film';
import { glassAsset, type IngredientAsset } from '../authoring/ingredients';
import type { Comp } from '../authoring/types';
import type { RowBuild, SetArt } from './row';

/** The pictures a film can play without paying for any: glass elements are drawn by the engine, every other element waits for its picture. */
function freeIngredients(board: CinematicBoard): Record<string, IngredientAsset> {
  const out: Record<string, IngredientAsset> = {};
  for (const e of board.elements) if (e.glass) out[e.id] = glassAsset(e);
  return out;
}

/**
 * The hero film of a row, or undefined when its build has no board (or one read off the disk that is not a board). The 3D film needs the
 * prepared product; a build without one, or a 3D build that throws, gets the 2D film from the floor board instead.
 */
export function heroFilm(build: RowBuild, product: Product): Comp | undefined {
  const board = readStoredBoard(build.film);
  if (!board) return undefined;
  const copy = {
    title: product.title,
    price: shownPrice(product),
    ...(product.salePrice !== undefined ? { wasPrice: product.price } : {}),
    ...(product.currency ? { currency: product.currency } : {}),
    ...(product.brand ? { brand: product.brand } : {}),
    accent: build.accent,
  };
  const prep = build.prepared;
  if (prep) {
    try {
      const t = prep.texture;
      return buildCinematicFilm({
        aspect: build.aspect,
        sheet: board.sheet,
        ...(board.tone ? { tone: board.tone } : {}),
        ...(board.key ? { key: board.key } : {}),
        texture: { id: t.id, src: `/api/assets/${t.id}`, width: t.width ?? 1024, height: t.height ?? 1024, kind: prep.textureKind },
        shape: prep.shape,
        side: prep.side,
        productAspect: prep.aspect,
        ...(prep.contour ? { contour: prep.contour as Array<[number, number]> } : {}),
        handheld: board.handheld ?? true,
        ...(board.tagline ? { tagline: board.tagline } : {}),
        ingredients: freeIngredients(board),
        ...(board.set && build.setArt ? { set: { look: board.set.look, air: board.set.air, backdrop: build.setArt.backdrop, ground: build.setArt.ground, ...(build.setArt.dot ? { dot: build.setArt.dot } : {}) } } : {}),
        ...copy,
      });
    } catch (e) {
      console.error(`catalog hero film for ${product.id}: the 3D film could not be built, using the 2D film:`, e);
    }
  }
  return buildBoardClip({
    aspect: build.aspect,
    board: floorCatalogBoard({ title: product.title, category: product.category, price: product.price, currency: product.currency }, { hasPlate: !!build.plate }),
    product: build.product,
    ...(build.plate ? { plate: build.plate } : {}),
    ...copy,
  });
}

const KEY_COLOR = { warm: '#ffd7a3', cool: '#bcd6ff', neutral: '#ffffff' } as const;

/**
 * The pictures of a board's set, drawn and stored once per look, light and frame shape (a run's second warm beach reuses the first). Free:
 * the backdrop and the dot are drawn by code. Undefined when the board names no set.
 */
export async function makeSetArt(assets: AssetStore, board: CinematicBoard, aspect: Aspect, memo: Map<string, SetArt>): Promise<SetArt | undefined> {
  const set = board.set;
  if (!set) return undefined;
  const { width: W, height: H } = ASPECT_SIZES[aspect];
  const key = [set.look, board.tone ?? '-', board.key ?? '-', set.air === 'bokeh', W / H > 1 ? 'wide' : W / H < 1 ? 'tall' : 'square'].join('|');
  const hit = memo.get(key);
  if (hit) return hit;
  const put = async (png: Buffer, width: number, height: number): Promise<{ id: string; src: string; width: number; height: number }> => {
    const ref = await assets.put(png, 'image/png', { role: 'still', sceneId: 'catalog' });
    return { id: ref.id, src: `/api/assets/${ref.id}`, width, height };
  };
  const back = await renderBackdrop({ look: set.look, ratio: W / H, ...(board.tone ? { tone: board.tone } : {}), ...(board.key ? { key: board.key } : {}) });
  const art: SetArt = { backdrop: await put(back.png, back.width, back.height), ground: groundColor(set.look, board.tone, board.key) };
  if (set.air === 'bokeh') {
    const dot = await renderDot(KEY_COLOR[board.tone ?? 'neutral']);
    art.dot = await put(dot.png, dot.width, dot.height);
  }
  memo.set(key, art);
  return art;
}

/** A board Muse already wrote, kept so a second run of the same feed directs nothing and pays nothing. */
export interface BoardEntry {
  board: CinematicBoard;
  source: 'muse' | 'floor';
}

export interface BoardCache {
  get(key: string): Promise<BoardEntry | undefined>;
  set(key: string, entry: BoardEntry): Promise<void>;
}

/** The key a board is kept under: the photo and what the board was written for (title, category, flat or round, the campaign brief). */
export function boardKey(photoKey: string, product: Product, flat: boolean, brief = ''): string {
  return createHash('sha256')
    .update(['cine5', photoKey, product.title, product.category, flat, brief.trim()].join('|'))
    .digest('hex');
}

/** Boards held in memory only: the fake's, so a fake board never stands in for a real one. */
export function createMemoryBoardCache(): BoardCache {
  const all = new Map<string, BoardEntry>();
  return {
    async get(key) {
      return all.get(key);
    },
    async set(key, entry) {
      all.set(key, entry);
    },
  };
}

/** The boards of a data dir, in `<dir>/catalogs/boards.json`: read once, written after every set, each write serialised. */
export function createBoardCache(dir: string): BoardCache {
  const file = join(dir, 'catalogs', 'boards.json');
  let loading: Promise<Record<string, BoardEntry>> | undefined;
  let chain: Promise<unknown> = Promise.resolve();
  const load = () =>
    (loading ??= readFile(file, 'utf8')
      .then((text) => JSON.parse(text) as Record<string, BoardEntry>)
      .catch(() => ({}) as Record<string, BoardEntry>));
  return {
    async get(key) {
      const entry = (await load())[key];
      return entry && readStoredBoard(entry.board) ? entry : undefined;
    },
    async set(key, entry) {
      const run = chain.then(async () => {
        const all = await load();
        all[key] = entry;
        await mkdir(dirname(file), { recursive: true });
        await writeFile(`${file}.tmp`, JSON.stringify(all));
        await rename(`${file}.tmp`, file);
      });
      chain = run.catch(() => undefined);
      return run;
    },
  };
}
