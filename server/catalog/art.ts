// Owned by Catalog Crew C1. The two paid art steps of a catalog run (a SAM cut-out, a Muse
// plate) behind one small interface, plus a free fake, so tests, e2e and DIRECTOR_FAKE runs
// stay offline and spend nothing.
import type { Buffer } from 'node:buffer';
import sharp from 'sharp';
import type { Aspect, AssetRef } from '@shared/composition';
import type { AssetStore } from '@shared/ports';
import type { ToolCtx } from '@shared/tools';
import type { LookId, OccasionId } from '../authoring/looks';
import { cutout } from '../art/cutout';
import { dominantAccent } from '../art/palette';
import { PRICE } from '../art/prices';
import { generateLookPlate } from '../art/stills';

/** A cut-out: the asset, its size and the colour the photo carries. */
export interface CatalogCut {
  id: string;
  width: number;
  height: number;
  accent: string;
  chroma: number;
  usd: number;
}

/** A look plate: the asset and its size. */
export interface CatalogPlate {
  id: string;
  width: number;
  height: number;
  usd: number;
}

/** The art a catalog run needs: one cut-out per photo, one plate per look. */
export interface CatalogArt {
  cut(bytes: Buffer, noun: string): Promise<CatalogCut>;
  plate(look: LookId, occasion: OccasionId, noun: string, aspect: Aspect): Promise<CatalogPlate>;
}

/** The asset store the real art reads back from: it resolves an id to the asset it holds. */
export type CatalogAssets = AssetStore & { get(id: string): Promise<AssetRef> };

/**
 * The real art: SAM cuts the product out of its photo and Muse Image paints the plate.
 * Both go through the carrier film's ctx, so their cost lands in its ledger too.
 */
export function realArt(ctx: ToolCtx, assets: CatalogAssets): CatalogArt {
  return {
    async cut(bytes, noun) {
      const r = await cutout(ctx, { source: bytes, noun, sceneId: 'catalog' });
      const ref = await assets.get(r.cutout.id);
      const acc = await dominantAccent(await assets.read(ref.id));
      return {
        id: ref.id,
        width: ref.width ?? 0,
        height: ref.height ?? 0,
        accent: acc.hex,
        chroma: acc.chroma,
        usd: PRICE.samImageUsd,
      };
    },
    async plate(look, occasion, noun, aspect) {
      const ref = await generateLookPlate(ctx, { look, occasion, productClass: `${noun}s`, aspect, sceneId: look });
      return { id: ref.id, width: ref.width ?? 0, height: ref.height ?? 0, usd: PRICE.museImageUsd };
    },
  };
}

/** The free art: a trim of the photo and a flat painted plate. No network, no spend. */
export interface FakeCatalogArt extends CatalogArt {
  calls: { cut: number; plate: number };
}

/** The flat plate the fake paints: a 9:16 canvas of one warm tone. */
const PLATE_WIDTH = 720;
const PLATE_HEIGHT = 1280;
const PLATE_BACKGROUND = '#d9cbb5';

export function fakeArt(assets: AssetStore): FakeCatalogArt {
  const calls = { cut: 0, plate: 0 };
  return {
    calls,
    async cut(bytes, _noun) {
      calls.cut++;
      const trimmed = await sharp(bytes).trim().png().toBuffer();
      const ref = await assets.put(trimmed, 'image/png', { role: 'cutout', sceneId: 'catalog' });
      const acc = await dominantAccent(trimmed);
      return {
        id: ref.id,
        width: ref.width ?? 0,
        height: ref.height ?? 0,
        accent: acc.hex,
        chroma: acc.chroma,
        usd: 0,
      };
    },
    async plate(look, _occasion, _noun, _aspect) {
      calls.plate++;
      const png = await sharp({
        create: { width: PLATE_WIDTH, height: PLATE_HEIGHT, channels: 3, background: PLATE_BACKGROUND },
      })
        .png()
        .toBuffer();
      const ref = await assets.put(png, 'image/png', { role: 'plate', sceneId: look });
      return { id: ref.id, width: PLATE_WIDTH, height: PLATE_HEIGHT, usd: 0 };
    },
  };
}
