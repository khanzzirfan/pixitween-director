import type { AssetStore } from '@shared/ports';
import { prepareProduct3D, type PrepareCache, type Prepared3D } from '../product3d/prepare';
import type { PrimitiveShape } from '../product3d/types';
import { buildHero3DClip } from './hero3d-clip';
import { productShape, type ClipLook } from './looks';
import { buildRetailClip, type ClipAsset } from './retail-clip';
import type { Aspect, Comp } from './types';

// One catalogue product's clip, whichever look it got: the 3D hero for a round pack, else the 2D retail clip.

/** The 3D shape for a product class; classes not listed are not tried in 3D. */
export const ROUND_NOUNS: Record<string, PrimitiveShape> = { can: 'can', bottle: 'bottle' };

/**
 * The wrapped label for a tall round pack, or undefined when the product is not one: a class with no round shape, a pack that is
 * not tall, or a cut-out with no straight body to unwrap. Free and offline; stores one label asset per cut-out (cached).
 */
export async function prepareRound(
  assets: AssetStore,
  cut: { id: string; width: number; height: number },
  noun: string,
  cache?: PrepareCache,
): Promise<Prepared3D | undefined> {
  const shape = ROUND_NOUNS[noun];
  if (!shape || productShape(cut.width, cut.height) !== 'tall') return undefined;
  const prep = await prepareProduct3D(assets, { cutoutAssetId: cut.id, shape }, cache);
  return prep.shape !== 'other' && prep.textureKind === 'label' ? prep : undefined;
}

export interface CatalogClipInput {
  aspect: Aspect;
  look: ClipLook;
  /** From prepareRound; required for hero-3d. */
  prepared?: Prepared3D;
  plate?: ClipAsset;
  product: ClipAsset;
  title: string;
  price: number;
  wasPrice?: number;
  currency?: string;
  brand?: string;
  accent: string;
}

export function buildCatalogClip(i: CatalogClipInput): Comp {
  const copy = {
    title: i.title,
    price: i.price,
    ...(i.wasPrice !== undefined ? { wasPrice: i.wasPrice } : {}),
    ...(i.currency ? { currency: i.currency } : {}),
    ...(i.brand ? { brand: i.brand } : {}),
    accent: i.accent,
  };
  if (i.look === 'hero-3d') {
    const p = i.prepared;
    if (!p || p.shape === 'other') throw new Error('the hero-3d look needs a round pack prepared by prepareRound');
    const t = p.texture;
    return buildHero3DClip({
      aspect: i.aspect,
      texture: { id: t.id, src: `/api/assets/${t.id}`, width: t.width ?? 2048, height: t.height ?? 1024, kind: p.textureKind },
      shape: p.shape,
      side: p.side,
      productAspect: p.aspect,
      ...copy,
    });
  }
  return buildRetailClip({ aspect: i.aspect, look: i.look, ...(i.plate ? { plate: i.plate } : {}), product: i.product, ...copy });
}
