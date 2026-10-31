import type { Buffer } from 'node:buffer';
import { z } from 'zod';
import type { ToolCtx } from '@shared/tools';
import { ArtError } from '../art/errors';
import { charge } from '../art/events';
import { cutoutSheet, whiteKeySheet } from '../art/cutout-sheet';
import { lintPrompt } from '../art/lint';
import { PRICE } from '../art/prices';
import { prepareProduct3D, type PrepareCache } from '../product3d/prepare';
import type { ClipAsset } from './retail-clip';

// The elements of a cinematic film: the real things round the product (coffee beans, ice, a splash, a lemon slice, steam...). Muse decides
// which ones suit the product by looking at its photo (beatsheet.ts planBoard); this file holds what an element is, the pictures that make
// one, and a small floor library used when Muse cannot be asked. Each element is ONE Muse picture (a sheet of pieces) and ONE SAM call.

export type IngredientAction = 'fall' | 'burst' | 'orbit' | 'drift' | 'splash' | 'swirl';
/** solid: an extruded cut-out (or a glass cube), thrown about by a swarm. card: a flat cut-out that faces the camera, a splash or a swirl. */
export type IngredientUse = 'solid' | 'card';

export interface ElementSpec {
  /** lower-case slug, [a-z0-9-], used by the beats */
  id: string;
  /** What SAM is asked to find in the picture, and what a person reads on the board. */
  name: string;
  use: IngredientUse;
  /** A solid drawn by the engine as a glass cube (ice, sugar): no picture is made. */
  glass?: boolean;
  /** One piece, in plain words, for the picture prompt: colour, material, shape. No brand names, no people, no text. */
  look: string;
  /** Pieces on the sheet: a solid uses 1; a card is a flipbook of this many stages (1 for a still card). */
  pieces: number;
  /** Size of one piece in metres, longest side (the product is 0.16 m tall). */
  sizeM: number;
}

const SHOT = 'on a plain white studio backdrop, clearly separated from it, high-end macro product photograph, sharp focus, soft key light from the upper left. Nothing else in the frame. No text, no logos, no hands.';

/** The picture prompt for an element, and the size to ask for (a row of stages is wide). Null for a glass element, which has no picture. */
export function elementPrompt(e: ElementSpec): { prompt: string; size: '1024x1024' | '1536x1024' } | null {
  if (e.glass) return null;
  if (e.use === 'card' && e.pieces > 1) {
    return { prompt: `${e.pieces} stages of ${e.look}, in one horizontal row from left to right, in order, each stage separate with empty space between, ${SHOT}`, size: '1536x1024' };
  }
  return { prompt: `One ${e.look}, centred ${SHOT}`, size: '1024x1024' };
}

const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{1,23}$/);
export const elementSchema = z.object({
  id: slug,
  name: z.string().min(2).max(40),
  use: z.enum(['solid', 'card']),
  glass: z.boolean().optional(),
  look: z.string().min(8).max(220),
  pieces: z.number().int().min(1).max(6),
  sizeM: z.number().positive().max(1),
});

export const MAX_ELEMENTS = 5;
const SIZE = { solid: [0.01, 0.08], card: [0.15, 0.5] } as const;

/**
 * Muse's elements made safe: bad shapes and elements whose words trip the prompt lint (brand names, named people) are dropped with a reason,
 * a solid gets one piece and a size of 1-8 cm, a card 15-50 cm, glass gets no picture, duplicates by id are dropped, at most MAX_ELEMENTS stay.
 */
export function sanitizeElements(raw: unknown): { elements: ElementSpec[]; dropped: string[] } {
  const dropped: string[] = [];
  const elements: ElementSpec[] = [];
  for (const [n, item] of (Array.isArray(raw) ? raw : []).entries()) {
    const p = elementSchema.safeParse(item);
    if (!p.success) {
      dropped.push(`element ${n + 1}: ${p.error.issues[0]?.message ?? 'wrong shape'}`);
      continue;
    }
    const e = p.data;
    if (elements.some((x) => x.id === e.id)) {
      dropped.push(`${e.id}: duplicate id`);
      continue;
    }
    const bad = [lintPrompt(e.look), lintPrompt(e.name)].flatMap((l) => l.violations);
    if (bad.length) {
      dropped.push(`${e.id}: ${bad.map((v) => `${v.rule} "${v.term}"`).join(', ')}`);
      continue;
    }
    const [lo, hi] = SIZE[e.use];
    elements.push({ ...e, pieces: e.use === 'solid' || e.glass ? 1 : e.pieces, sizeM: Math.round(Math.min(hi, Math.max(lo, e.sizeM)) * 1000) / 1000, ...(e.glass ? { glass: true, use: 'solid' as const } : {}) });
  }
  if (elements.length > MAX_ELEMENTS) dropped.push(...elements.slice(MAX_ELEMENTS).map((e) => `${e.id}: over the limit of ${MAX_ELEMENTS}`));
  return { elements: elements.slice(0, MAX_ELEMENTS), dropped };
}

const one = (id: string, name: string, use: IngredientUse, look: string, sizeM: number, pieces = 1, glass?: boolean): ElementSpec => ({ id, name, use, look, pieces, sizeM, ...(glass ? { glass: true } : {}) });
/** The floor library, used when Muse is not asked or fails: common drink and food elements the director already knows how to draw. */
export const FLOOR: Record<string, ElementSpec> = {
  bean: one('bean', 'coffee bean', 'solid', 'roasted coffee bean, glossy dark brown with its centre crease, seen from slightly above', 0.02),
  cocoa: one('cocoa', 'chocolate shard', 'solid', 'broken shard of dark chocolate with a clean snapped edge', 0.022),
  ice: one('ice', 'ice cube', 'solid', 'clear ice cube', 0.03, 1, true),
  vanilla: one('vanilla', 'vanilla pod', 'solid', 'dark vanilla pod, slightly curled, with fine texture', 0.05),
  citrus: one('citrus', 'lemon slice', 'solid', 'thin lemon slice, cut across, glistening, seen face on', 0.04),
  mint: one('mint', 'mint leaf', 'solid', 'fresh mint leaf with fine veins, slightly curled', 0.035),
  splash: one('splash', 'liquid splash', 'card', 'liquid splash of coffee-coloured liquid with droplets: a small crown rising, a wide crown with thin fingers, a large open crown at its peak, the crown collapsing into scattered droplets', 0.3, 4),
  milk: one('milk', 'milk swirl', 'card', 'soft swirl of white milk twisting through the air, with thin trailing ribbons and a few droplets', 0.35),
};

const WORDS: Array<[RegExp, string[]]> = [
  [/\b(coffee|brew|latte|espresso|mocha|cappuccino)\b/i, ['bean', 'ice', 'splash', 'milk']],
  [/\b(mocha|chocolate|cocoa)\b/i, ['cocoa']],
  [/\b(vanilla)\b/i, ['vanilla']],
  [/\b(lemon|lime|citrus|orange|soda|lemonade)\b/i, ['citrus', 'ice', 'splash']],
  [/\b(mint|tea|herbal)\b/i, ['mint', 'ice']],
];

/**
 * The floor library's kinds for a product, from its words: each matching group adds its kinds, and a product that matches nothing gets ice
 * and a splash. This is only the fallback; the board normally comes from Muse looking at the product.
 */
export function ingredientsFor(title: string, category = ''): string[] {
  const text = `${category} ${title}`;
  const out: string[] = [];
  for (const [re, kinds] of WORDS) if (re.test(text)) for (const k of kinds) if (!out.includes(k)) out.push(k);
  return out.length ? out : ['ice', 'splash'];
}
export const floorElements = (title: string, category = ''): ElementSpec[] => ingredientsFor(title, category).map((k) => FLOOR[k]!);

/** A short stable hash, so a changed description draws a new picture instead of reusing the old one. */
const hash = (s: string): string => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
};
/** The registry key of an element's pictures: its id and what it looks like. */
export const elementKey = (e: ElementSpec): string => `${e.id}-${hash(`${e.look}|${e.pieces}|${e.use}|${e.glass ?? false}`)}`;

/** The most a set costs to draw: a Muse picture and a SAM call per element with a picture; glass and elements already made cost nothing. */
export const elementCostUsd = (elements: readonly ElementSpec[], made: ReadonlySet<string> = new Set()): number =>
  Math.round(elements.filter((e) => !e.glass && !made.has(elementKey(e))).length * (PRICE.museImageUsd + PRICE.samImageUsd) * 10000) / 10000;

/** What the builder needs to play one element. */
export interface IngredientAsset {
  /** the element id; a beat names it */
  kind: string;
  use: IngredientUse;
  sizeM: number;
  /** The cut-out pictures: one for a solid or a still card, several (in order) for a flipbook. Empty for glass. */
  frames: ClipAsset[];
  /** Solids only: the outline in the front picture's pixels, to extrude. */
  contour?: Array<[number, number]>;
  /** Solids only: the colour of the sides of the extrusion, #rrggbb. */
  side?: string;
  procedural?: 'glass-cube';
}

/** The words SAM is asked for, most exact first: the element's name ("cold brew splash"), then its last word ("splash"). */
export const samNouns = (name: string): string[] => [...new Set([name.trim(), name.trim().split(/\s+/).at(-1) ?? ''].filter(Boolean))];

/**
 * Cuts the sheet: SAM with the element's name, then with its last word (one call each, about $0.0025), then free: the white backdrop keyed out
 * and the sheet split at its empty columns (SAM finds nothing on some liquid sheets, e.g. a coffee stream). Throws when even that finds nothing.
 */
async function cutWithFallback(ctx: ToolCtx, sheet: Buffer, e: ElementSpec, sceneId?: string) {
  const max = e.use === 'card' ? e.pieces : 1;
  for (const noun of samNouns(e.name)) {
    try {
      return await cutoutSheet(ctx, { source: sheet, noun, max, ...(sceneId ? { sceneId } : {}) });
    } catch (err) {
      if (!(err instanceof ArtError) || err.code !== 'no-object') throw err;
    }
  }
  try {
    return await whiteKeySheet(ctx, { source: sheet, max, ...(sceneId ? { sceneId } : {}) });
  } catch {
    throw new ArtError('no-object', `no ${e.name} found in the sheet (tried ${samNouns(e.name).map((n) => `"${n}"`).join(', ')} and a white key)`);
  }
}

/** The asset of a glass element: no picture, the engine draws a cube. */
export const glassAsset = (e: ElementSpec): IngredientAsset => ({ kind: e.id, use: 'solid', sizeM: e.sizeM, frames: [], procedural: 'glass-cube' });

/**
 * Draws one element: a Muse picture (a sheet of its pieces), one SAM call that cuts every piece out, and for a solid the outline to extrude.
 * Paid (about $0.0125). The caller prints the estimate and has the user's `--yes`; this never runs unless called.
 */
export async function makeElement(ctx: ToolCtx, e: ElementSpec, o: { sceneId?: string; cache?: PrepareCache; image?: (prompt: string, size: string) => Promise<Buffer> } = {}): Promise<IngredientAsset> {
  const p = elementPrompt(e);
  if (!p) return glassAsset(e);
  const lint = lintPrompt(p.prompt);
  if (!lint.ok) throw new ArtError('lint', `prompt rejected: ${lint.violations.map((v) => `${v.rule} "${v.term}"`).join(', ')}`);
  const sheet = await (o.image ?? ((prompt, size) => ctx.meta.image.generate(prompt, size)))(p.prompt, p.size);
  charge(ctx, 'muse-image-1.0', '1 image', PRICE.museImageUsd);
  let pieces: Awaited<ReturnType<typeof cutoutSheet>>;
  try {
    pieces = await cutWithFallback(ctx, sheet, e, o.sceneId);
  } catch (err) {
    // keep the picture SAM could not cut, so a person can see why
    if (err instanceof ArtError && err.code === 'no-object' && ctx.assets?.put) {
      const kept = await ctx.assets.put(sheet, 'image/png', { role: 'still', ...(o.sceneId ? { sceneId: o.sceneId } : {}) });
      throw new ArtError('no-object', `${err.message}; the sheet is ${kept.id}`);
    }
    throw err;
  }
  const ref = (id: string, width: number, height: number): ClipAsset => ({ id, src: `/api/assets/${id}`, width, height });
  if (e.use === 'card') return { kind: e.id, use: 'card', sizeM: e.sizeM, frames: pieces.map((x) => ref(x.asset.id, x.width, x.height)) };
  const first = pieces[0]!;
  const prep = await prepareProduct3D(ctx.assets, { cutoutAssetId: first.asset.id, shape: 'other', ...(o.sceneId ? { sceneId: o.sceneId } : {}) }, o.cache);
  return {
    kind: e.id,
    use: 'solid',
    sizeM: e.sizeM,
    frames: [ref(prep.texture.id, prep.texture.width ?? first.width, prep.texture.height ?? first.height)],
    ...(prep.contour ? { contour: prep.contour as Array<[number, number]> } : {}),
    side: prep.side,
  };
}
