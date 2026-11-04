import type { Buffer } from 'node:buffer';
import { z } from 'zod';
import type { ToolCtx } from '@shared/tools';
import { ArtError } from '../art/errors';
import { charge } from '../art/events';
import { cutoutSheet, whiteKeySheet } from '../art/cutout-sheet';
import { lintPrompt } from '../art/lint';
import { PRICE } from '../art/prices';
import { prepareProduct3D, type PrepareCache } from '../product3d/prepare';
import { ELEMENT_FORMS, type ElementForm } from './forms';
import type { ClipAsset } from './retail-clip';

// The elements of a cinematic film: the real things round the product (coffee beans, ice, a splash, a lemon slice, steam...). Muse decides
// which ones suit the product by looking at its photo (beatsheet.ts planBoard); this file holds what an element is, the pictures that make
// one, and a small floor library used when Muse cannot be asked. Each element is ONE Muse picture (a sheet of pieces) and ONE SAM call.

export type IngredientAction = 'fall' | 'burst' | 'orbit' | 'drift' | 'splash' | 'swirl' | 'pour' | 'rise' | 'wrap';
/**
 * solid: an extruded cut-out (or a glass cube), thrown about by a swarm. card: a flat cut-out that faces the camera (smoke, steam, powder,
 * sparkle). liquid: a real 3D liquid the engine draws (metaballs in a glossy material): it splashes round the product, pours beside it or
 * floats round it as drops. vapour: soft steam, smoke or powder the engine draws (rising wisps, a rolling cloud, a burst of dust), set
 * behind and around the product. No picture is made for a liquid or a vapour.
 */
export type IngredientUse = 'solid' | 'card' | 'liquid' | 'vapour';

export interface ElementSpec {
  /** lower-case slug, [a-z0-9-], used by the beats */
  id: string;
  /** What SAM is asked to find in the picture, and what a person reads on the board. */
  name: string;
  use: IngredientUse;
  /** A solid drawn by the engine as a glass cube (ice, sugar): no picture is made. */
  glass?: boolean;
  /** The colour of a liquid (coffee, milk, juice, honey, perfume) or a vapour (white steam, grey smoke, brown cocoa powder), #rrggbb. */
  color?: string;
  /** A see-through liquid (water, a clear perfume, a light juice): drawn with transmission, so the set shows through it. Liquids only. */
  clear?: boolean;
  /** One piece, in plain words, for the picture prompt: colour, material, shape. No brand names, no people, no text. */
  look: string;
  /** Pieces on the sheet: a solid uses 1; a card is a flipbook of this many stages (1 for a still card). */
  pieces: number;
  /** Size of one piece in metres, longest side (the product is 0.16 m tall). */
  sizeM: number;
  /** A solid's 3D shape, Muse's word: round (a berry), thin (a leaf), chunk (a slice). Absent means chunk. */
  form?: ElementForm;
}

// floating, with no shadow or reflection under it: the cut-out keeps whatever touches the piece, and a blueberry came back fused to a white disc
const SHOT = 'on a plain white studio backdrop, floating clear of it, with no shadow, reflection, plate or surface under it, high-end macro product photograph, sharp focus, soft key light from the upper left. Nothing else in the frame. No text, no logos, no hands.';

/** The picture prompt for an element, and the size to ask for (a row of stages is wide). Null for glass, liquid and vapour, which have no picture. */
export function elementPrompt(e: ElementSpec): { prompt: string; size: '1024x1024' | '1536x1024' } | null {
  if (e.glass || e.use === 'liquid' || e.use === 'vapour') return null;
  if (e.use === 'card' && e.pieces > 1) {
    return { prompt: `${e.pieces} stages of ${e.look}, in one horizontal row from left to right, in order, each stage separate with empty space between, ${SHOT}`, size: '1536x1024' };
  }
  return { prompt: `One ${e.look}, centred ${SHOT}`, size: '1024x1024' };
}

const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{1,23}$/);
export const elementSchema = z.object({
  id: slug,
  name: z.string().min(2).max(40),
  use: z.enum(['solid', 'card', 'liquid', 'vapour']),
  glass: z.boolean().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  clear: z.boolean().optional(),
  look: z.string().min(8).max(220),
  pieces: z.number().int().min(1).max(6),
  sizeM: z.number().positive().max(1),
  form: z.enum(ELEMENT_FORMS).optional().catch(undefined),
});

export const MAX_ELEMENTS = 5;
/** Sizes in metres: a solid piece, a card, the box a liquid plays in, and the height of a vapour (the product is 0.16 m tall). */
const SIZE = { solid: [0.01, 0.08], card: [0.15, 0.5], liquid: [0.2, 0.42], vapour: [0.2, 0.5] } as const;
/** A vapour that names no colour is pale steam. */
const VAPOUR_COLOR = '#f2ece4';

/**
 * Muse's elements made safe: bad shapes and elements whose words trip the prompt lint (brand names, named people) are dropped with a reason,
 * a solid gets one piece and a size of 1-8 cm, a card 15-50 cm, a liquid 20-42 cm and must name its colour, a vapour 20-50 cm (pale
 * steam unless it names a colour), glass, liquids and vapours get no
 * picture, duplicates by id are dropped, at most MAX_ELEMENTS stay.
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
    if (e.use === 'liquid' && !e.color) {
      dropped.push(`${e.id}: a liquid needs its colour (#rrggbb)`);
      continue;
    }
    const [lo, hi] = SIZE[e.glass ? 'solid' : e.use];
    const { color: _c, clear: _l, ...rest } = e;
    // colour and clearness belong to a liquid, colour to a vapour; glass is always a solid
    const liquid = e.glass ? {} : e.use === 'liquid' ? { color: e.color!.toLowerCase(), ...(e.clear ? { clear: true } : {}) } : e.use === 'vapour' ? { color: (e.color ?? VAPOUR_COLOR).toLowerCase() } : {};
    elements.push({ ...rest, ...liquid, pieces: e.use === 'card' && !e.glass ? e.pieces : 1, sizeM: Math.round(Math.min(hi, Math.max(lo, e.sizeM)) * 1000) / 1000, ...(e.glass ? { glass: true, use: 'solid' as const } : {}) });
  }
  if (elements.length > MAX_ELEMENTS) dropped.push(...elements.slice(MAX_ELEMENTS).map((e) => `${e.id}: over the limit of ${MAX_ELEMENTS}`));
  return { elements: elements.slice(0, MAX_ELEMENTS), dropped };
}

const one = (id: string, name: string, use: IngredientUse, look: string, sizeM: number, pieces = 1, glass?: boolean): ElementSpec => ({ id, name, use, look, pieces, sizeM, ...(glass ? { glass: true } : {}) });
const vapour = (id: string, name: string, look: string, color: string, sizeM: number): ElementSpec => ({ id, name, use: 'vapour', look, pieces: 1, sizeM, color });
const liquid = (id: string, name: string, look: string, color: string, clear = false): ElementSpec => ({ id, name, use: 'liquid', look, pieces: 1, sizeM: 0.3, color, ...(clear ? { clear: true } : {}) });
/** The floor library, used when Muse is not asked or fails: elements for several kinds of product (drink, food, water and beach, outdoor, general) the director already knows how to draw. */
export const FLOOR: Record<string, ElementSpec> = {
  bean: one('bean', 'coffee bean', 'solid', 'roasted coffee bean, glossy dark brown with its centre crease, seen from slightly above', 0.02),
  cocoa: one('cocoa', 'chocolate shard', 'solid', 'broken shard of dark chocolate with a clean snapped edge', 0.022),
  ice: one('ice', 'ice cube', 'solid', 'clear ice cube', 0.03, 1, true),
  vanilla: one('vanilla', 'vanilla pod', 'solid', 'dark vanilla pod, slightly curled, with fine texture', 0.05),
  citrus: one('citrus', 'lemon slice', 'solid', 'thin lemon slice, cut across, glistening, seen face on', 0.04),
  mint: one('mint', 'mint leaf', 'solid', 'fresh mint leaf with fine veins, slightly curled', 0.035),
  splash: liquid('splash', 'coffee splash', 'glossy dark coffee', '#4a2a16'),
  water: liquid('water', 'water splash', 'clear water', '#d8eef8', true),
  sand: one('sand', 'sand pile', 'solid', 'small pile of golden beach sand with a few grains falling', 0.03),
  shell: one('shell', 'sea shell', 'solid', 'small cream and pink scallop sea shell, seen from above', 0.035),
  leaf: one('leaf', 'green leaf', 'solid', 'fresh green leaf with fine veins, slightly curled', 0.04),
  spark: one('spark', 'sparkle burst', 'card', 'soft burst of bright glints and sparkles with a light bloom, white and gold', 0.3, 3),
  dust: vapour('dust', 'dust cloud', 'soft cloud of fine pale dust hanging in the light', '#d9d0c2', 0.36),
  steam: vapour('steam', 'steam', 'soft white steam rising in wisps', '#f4efe8', 0.32),
  milk: liquid('milk', 'milk', 'creamy white milk', '#f1ebdf'),
};

const WORDS: Array<[RegExp, string[]]> = [
  [/\b(coffee|brew|latte|espresso|mocha|cappuccino)\b/i, ['bean', 'ice', 'splash', 'milk']],
  [/\b(hot|steam\w*|espresso|latte|cappuccino|tea|soup|ramen|noodles?|cocoa)\b/i, ['steam']],
  [/\b(mocha|chocolate|cocoa)\b/i, ['cocoa']],
  [/\b(vanilla)\b/i, ['vanilla']],
  [/\b(lemon|lime|citrus|orange|soda|lemonade)\b/i, ['citrus', 'ice', 'splash']],
  [/\b(mint|tea|herbal)\b/i, ['mint', 'ice']],
  [/\b(swim\w*|goggles?|beach|surf\w*|pool|sea|ocean|snorkel\w*|towel|sunscreen)\b/i, ['water', 'sand', 'shell']],
  [/\b(camp\w*|hik\w*|trail|outdoor|garden|plant|garment|jacket|boots?|backpack)\b/i, ['leaf', 'dust']],
];

/**
 * The floor library's kinds for a product, from its words: each matching group adds its kinds, and a product that matches nothing gets a sparkle
 * burst and a dust cloud (they suit anything). This is only the fallback; the board normally comes from Muse looking at the product.
 */
export function ingredientsFor(title: string, category = ''): string[] {
  const text = `${category} ${title}`;
  const out: string[] = [];
  for (const [re, kinds] of WORDS) if (re.test(text)) for (const k of kinds) if (!out.includes(k)) out.push(k);
  return out.length ? out : ['spark', 'dust'];
}
export const floorElements = (title: string, category = ''): ElementSpec[] => ingredientsFor(title, category).map((k) => FLOOR[k]!);

/** A short stable hash, so a changed description draws a new picture instead of reusing the old one. */
const hash = (s: string): string => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
};
/** The registry key of an element's pictures: its id and what it looks like. */
export const elementKey = (e: ElementSpec): string => `${e.id}-${hash(`${e.look}|${e.pieces}|${e.use}|${e.glass ?? false}${e.use === 'liquid' || e.use === 'vapour' ? `|${e.color}|${e.clear ?? false}` : ''}`)}`;

/** The most a set costs to draw: a Muse picture and a SAM call per element with a picture; glass and elements already made cost nothing. */
export const elementCostUsd = (elements: readonly ElementSpec[], made: ReadonlySet<string> = new Set()): number =>
  Math.round(elements.filter((e) => !e.glass && e.use !== 'liquid' && e.use !== 'vapour' && !made.has(elementKey(e))).length * (PRICE.museImageUsd + PRICE.samImageUsd) * 10000) / 10000;

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
  /** Solids only: how the piece is built in 3D (round, thin, chunk). Absent means chunk. */
  form?: ElementForm;
  /** Liquids and vapours: the colour; liquids: whether it is see-through. */
  color?: string;
  clear?: boolean;
  procedural?: 'glass-cube' | 'liquid' | 'vapour';
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

/** The asset of a liquid: no picture, the engine draws it in its colour. */
export const liquidAsset = (e: ElementSpec): IngredientAsset => ({ kind: e.id, use: 'liquid', sizeM: e.sizeM, frames: [], procedural: 'liquid', color: e.color ?? '#4a2a16', ...(e.clear ? { clear: true } : {}) });

/** The asset of a vapour: no picture, the engine draws it in its colour. */
export const vapourAsset = (e: ElementSpec): IngredientAsset => ({ kind: e.id, use: 'vapour', sizeM: e.sizeM, frames: [], procedural: 'vapour', color: e.color ?? VAPOUR_COLOR });

/**
 * Draws one element: a Muse picture (a sheet of its pieces), one SAM call that cuts every piece out, and for a solid the outline to extrude.
 * Paid (about $0.0125). The caller prints the estimate and has the user's `--yes`; this never runs unless called.
 */
export async function makeElement(ctx: ToolCtx, e: ElementSpec, o: { sceneId?: string; cache?: PrepareCache; image?: (prompt: string, size: string) => Promise<Buffer> } = {}): Promise<IngredientAsset> {
  if (e.use === 'liquid') return liquidAsset(e);
  if (e.use === 'vapour') return vapourAsset(e);
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
    ...(e.form ? { form: e.form } : {}),
  };
}
