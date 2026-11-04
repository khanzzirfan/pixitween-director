import { readFile } from 'node:fs/promises';
import { isFakeDirector } from '../agent/fake-director';
import sharp from 'sharp';
import { ASPECT_SIZES, type Aspect } from '@shared/composition';
import type { AepCompositionJson } from '@shared/aep';
import type { ToolCtx } from '@shared/tools';
import { cutout } from '../art/cutout';
import { dominantAccent } from '../art/palette';
import { choosesFlat, isFailureText, planBoard, reviewBoard, type BoardBody, type CinematicBoard } from '../authoring/beatsheet';
import { PRODUCT_FORMS, productBody, type ProductForm } from '../authoring/forms';
import { finishedComposition } from './finish-film';
import { commitCuts, keeps3d, pickForm } from './form-pick';
import { renderKeyFrames, reviewEnabled, reviewFrames } from './frame-review';
import { prepareRound } from '../authoring/catalog-clip';
import { buildCinematicFilm, type CinematicInput } from '../authoring/cinematic-film';
import { elementKey, makeElement, type IngredientAsset } from '../authoring/ingredients';
import { groundColor, renderBackdrop, renderDot } from '../authoring/set-art';
import { newPrepareCache, prepareProduct3D, type Prepared3D } from '../product3d/prepare';

const FALLBACK_ACCENT = '#3d4a5c';
/** Elements drawn so far in this process, by key: a second film with the same beans or splash pays nothing. */
const drawn = new Map<string, IngredientAsset>();
const prepared = newPrepareCache();

/** The prices a brief or a storyboard names: the lowest is the one shown, a higher one is the price it was. */
export function pricesIn(text: string): { price: number; was?: number } | undefined {
  const found = [...text.matchAll(/(?:\$|USD\s?)\s?(\d{1,4}(?:\.\d{1,2})?)/g)].map((m) => Number(m[1])).filter((n) => n > 0);
  if (!found.length) return undefined;
  const price = Math.min(...found);
  const was = Math.max(...found);
  return was > price ? { price, was } : { price };
}

/** True when a film's stored title is a real name: short, and not the brief itself (a film with no title is named after its brief). A brief may open with the product's name; a title that is a clause of the brief (a comma, or six words or more) is the brief. */
export function isProductTitle(title: string | undefined, brief: string): boolean {
  const t = title?.trim();
  if (!t || t.split(/\s+/).length > 6 || /[$€£¥₹\d]/.test(t)) return false;
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return !norm(brief).startsWith(norm(t)) || (norm(t).split(' ').length <= 5 && !t.includes(','));
}

/** True when a reading of the pack is a name, not Muse saying it could not read one ("Not visible", "Unknown", "N/A"). */
export function isReadName(name: string): boolean {
  return /[a-z]/i.test(name) && !isFailureText(name) && !/^(no|none|null|nothing|undefined|na)\b|\bno (name|text|label)\b/i.test(name.trim());
}

/** A product name the client wrote in quotes in the brief ("Pure Spoonful"): the surest name there is, ahead of reading the pack. */
export function quotedName(brief: string): string | undefined {
  for (const m of brief.matchAll(/["\u201c\u2018']([^"\u201d\u2019'\n]{2,32})["\u201d\u2019']/g)) {
    const name = m[1]!.trim();
    const words = name.split(/\s+/).length;
    if (words >= 1 && words <= 4 && /[a-z]/i.test(name) && !/[.!?]$/.test(name) && isReadName(name)) return name;
  }
  return undefined;
}

/** Words a brief opens with that describe the film, not the product ("Cinematic 10s vertical (9:16) ..."): never a name for the end card. */
const FILM_WORDS = /^(cinematic|vertical|horizontal|square|portrait|landscape|ad|ads|advert|video|film|reel|spot|commercial|promo|\d+(\.\d+)?s?|\(?\d+:\d+\)?|for|a|an|the|of)$/i;

/** A short name for the end card: one the brief quotes, else the one Muse reads off the pack, else the brief's first words that are not about the film (a brief is a sentence, not a name). */
async function productName(ctx: ToolCtx, photo: Buffer, brief: string): Promise<string> {
  try {
    const reply = (await ctx.meta.spark.reviewImages([photo], 'Read the product name printed on this pack. Reply as JSON {"name": "<brand and product, at most 4 words, title case>"}.')) as { name?: unknown };
    ctx.ledger.add(ctx.filmId, 'muse-spark-1.3-contributor', '1 call', 0.005);
    const name = typeof reply?.name === 'string' ? reply.name.trim() : '';
    if (name && name.length <= 32 && isReadName(name)) return name;
  } catch {
    /* fall through to the brief */
  }
  return brief.split(/[,.—-]/)[0]!.trim().split(/\s+/).filter((w) => !FILM_WORDS.test(w)).slice(0, 4).join(' ').slice(0, 32) || 'New';
}

/** The relative luminance of a picture's top third, where the end card's words sit. */
export async function topLuma(png: Buffer): Promise<number> {
  const img = sharp(png);
  const { width = 1, height = 1 } = await img.metadata();
  const top = await img.extract({ left: 0, top: 0, width, height: Math.max(1, Math.round(height / 3)) }).removeAlpha().png().toBuffer();
  const { channels } = await sharp(top).stats();
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return Math.round((0.2126 * lin(channels[0]!.mean) + 0.7152 * lin(channels[1]!.mean) + 0.0722 * lin(channels[2]!.mean)) * 1000) / 1000;
}

/** The word the cut-out looks for: the last word of the product's name ("Clear Water Swim Goggles" -> "goggles"). */
export function productNoun(title: string): string {
  const w = title.toLowerCase().replace(/[^a-z\s-]/g, ' ').trim().split(/\s+/).filter((x) => x.length > 2);
  return w[w.length - 1] ?? 'product';
}

/** The words of a name from its end back, the likeliest nouns first, without the first and without repeats ("Clear Water Swim Goggles" -> swim, water). */
export function otherNouns(title: string, first: string): string[] {
  const w = title.toLowerCase().replace(/[^a-z\s-]/g, ' ').trim().split(/\s+/).filter((x) => x.length > 2 && x !== first);
  return [...new Set(w.reverse())].slice(0, 3);
}

/** The product's form (round, boxy, slab, lying), asked of Muse with the photo when its board did not name one: one call, $0.005. Undefined when the look fails. */
export async function formFromPhoto(ctx: ToolCtx, photo: Buffer, title: string): Promise<ProductForm | undefined> {
  try {
    const reply = (await ctx.meta.spark.reviewImages(
      [photo],
      `This is "${title}". It will be built as a 3D solid from its photo. What is its 3D form? round: round when seen from above (a bottle, can, tub, jar, cup, fruit), as deep as it is wide. boxy: a carton, box or square bottle with flat faces. slab: a thin flat thing standing up (a folded towel, a pouch, a book, a phone). lying: a round thing lying on its side (a rolled towel, a rolling pin, a loaf). Reply as JSON {"form": "round|boxy|slab|lying"}.`,
    )) as { form?: unknown };
    ctx.ledger.add(ctx.filmId, 'muse-spark-1.3-contributor', '1 call', 0.005);
    return PRODUCT_FORMS.find((f) => f === reply?.form);
  } catch {
    return undefined;
  }
}

/** What the thing in the photo is called, in a word or two each, most specific first: asked of Muse when the words of the name find nothing. */
async function nounsFromPhoto(ctx: ToolCtx, photo: Buffer): Promise<string[]> {
  try {
    const reply = (await ctx.meta.spark.reviewImages([photo], 'What is the main product in this photo? Reply as JSON {"nouns": ["<what it is, one or two lowercase words, as a shopper would say it>", "<a more general word for it>", "<its shape or container, for example bottle, box, can>"]}.')) as { nouns?: unknown };
    ctx.ledger.add(ctx.filmId, 'muse-spark-1.3-contributor', '1 call', 0.005);
    return Array.isArray(reply?.nouns) ? reply.nouns.filter((n): n is string => typeof n === 'string' && n.trim().length > 0 && n.length <= 30).map((n) => n.trim().toLowerCase()).slice(0, 4) : [];
  } catch {
    return [];
  }
}

/** The narrowest row of the top part of a pack, over its body's typical width, below which it has a neck, shoulders or a cap. */
export const STRAIGHT_SHARE = 0.85;

/**
 * Whether a cut-out is a straight cylinder from top to bottom (a can), read off its outline: the widths of its rows in the top fifth stay
 * close to the median width of its body. A bottle's neck, a perfume's shoulders and cap, a tube's crimp all fail it, and those keep their own
 * outline as a flat cut-out instead of becoming a plain can.
 */
export async function isStraightCylinder(png: Buffer): Promise<boolean> {
  const { data, info } = await sharp(png).ensureAlpha().extractChannel('alpha').raw().toBuffer({ resolveWithObject: true });
  const widths: number[] = [];
  for (let y = 0; y < info.height; y++) {
    let left = -1;
    let right = -1;
    for (let x = 0; x < info.width; x++) {
      if (data[y * info.width + x]! > 128) {
        if (left < 0) left = x;
        right = x;
      }
    }
    if (left >= 0) widths.push(right - left + 1);
  }
  if (widths.length < 10) return false;
  const body = [...widths.slice(Math.floor(widths.length * 0.3), Math.floor(widths.length * 0.9))].sort((a, b) => a - b);
  const median = body[Math.floor(body.length / 2)]!;
  // the very top rows are the rim's curve on any can: skip them
  const top = widths.slice(Math.floor(widths.length * 0.04), Math.max(Math.floor(widths.length * 0.04) + 1, Math.floor(widths.length * 0.2)));
  return Math.min(...top) >= median * STRAIGHT_SHARE;
}

/**
 * The product in 3D: a tall straight cylinder (a can) wears its unwrapped label; anything else, a bottle with a neck or a cap included, is a
 * thick cut-out of its photo, extruded from its own outline.
 */
async function prepareProduct(ctx: ToolCtx, photo: Buffer, title: string): Promise<{ cutId: string; prep: Prepared3D } | undefined> {
  const noun = productNoun(title);
  const tried = [noun, ...otherNouns(title, noun)];
  // the words of the name first; when SAM finds nothing for them, Muse says what is in the photo and those words are tried, a little less strictly
  const cut = await cutout(ctx, { source: photo, noun, alsoTry: tried.slice(1), sceneId: 'cinematic' }).catch(async () => {
    const seen = new Set(tried);
    const named = (await nounsFromPhoto(ctx, photo)).filter((n) => !seen.has(n));
    return named.length ? cutout(ctx, { source: photo, noun: named[0]!, alsoTry: named.slice(1), minConfidence: 0.35, sceneId: 'cinematic' }).catch(() => undefined) : undefined;
  });
  if (!cut) return undefined;
  const c = { id: cut.cutout.id, width: cut.cutout.width ?? 0, height: cut.cutout.height ?? 0 };
  const straight = await isStraightCylinder(await ctx.assets.read(c.id)).catch(() => false);
  const round = straight ? await prepareRound(ctx.assets, c, 'can', prepared).catch(() => undefined) : undefined;
  if (round) return { cutId: c.id, prep: round };
  const flat = await prepareProduct3D(ctx.assets, { cutoutAssetId: c.id, shape: 'other' }, prepared).catch(() => undefined);
  return flat && flat.contour && flat.contour.length >= 3 ? { cutId: c.id, prep: flat } : undefined;
}

/** Everything slow the cut needs, made once per film: the 3D product, the board, its element pictures, the set and the music. */
export interface CinematicParts {
  title: string;
  aspect: Aspect;
  prep: Prepared3D;
  accent: string;
  board: ReturnType<typeof reviewBoard>['board'];
  /** the product's body, from Muse's form (on the board, or asked with the photo when the board had none); a later board with a form wins */
  body?: BoardBody;
  ingredients: Record<string, IngredientAsset>;
  set: CinematicInput['set'];
  bed?: { id: string; url: string };
}

/** Parts started early (startCinematic), by film id, so the finish only builds. */
const early = new Map<string, Promise<CinematicParts | undefined>>();

async function prepareParts(ctx: ToolCtx, log: (line: string) => void, o: { seconds?: number } = {}): Promise<CinematicParts | undefined> {
  const film = await ctx.films.get(ctx.filmId);
  const photoRef = film.assets.find((a) => a.role === 'product-photo');
  if (!photoRef) return undefined;
  const photo = await ctx.assets.read(photoRef.id);
  const title = isProductTitle(film.title, film.brief.text) ? film.title!.trim() : (quotedName(film.brief.text) ?? (await productName(ctx, photo, film.brief.text)));
  const made = await prepareProduct(ctx, photo, title);
  if (!made) return undefined;
  const { prep } = made;
  const flat = prep.shape === 'other';
  const accent = await dominantAccent(await ctx.assets.read(made.cutId));

  const planned = await planBoard(ctx, { title, brief: film.brief.text, photo, seconds: o.seconds ?? Math.min(10, film.storyboard?.durationSec ?? 8), flat });
  const { board } = reviewBoard(planned.board);
  // the body's form is always Muse's word: from the board, or one look at the photo when the board left it out
  const body = !flat ? undefined : board.body?.form ? board.body : await formFromPhoto(ctx, photo, title).then((f) => (f ? productBody(f, board.body?.depth) : board.body));
  log(`board by ${planned.source}: ${board.concept}${flat ? ` (a body from its outline: ${body?.form ?? 'no form, the default depth'}${body?.form && !board.body?.form ? ', asked with the photo' : ''})` : ''}`);
  if (planned.source === 'floor') log(`Muse's board was not used: ${planned.violations.slice(0, 4).join('; ')}`);
  else if (planned.violations.length) log(`Muse's board kept; taste rules it still breaks: ${planned.violations.slice(0, 4).join('; ')}`);

  const ingredients: Record<string, IngredientAsset> = {};
  await Promise.all(
    board.elements.map(async (e) => {
      const key = elementKey(e);
      try {
        const made = drawn.get(key) ?? (await makeElement(ctx, e, { cache: prepared }));
        drawn.set(key, made);
        ingredients[e.id] = { ...made, kind: e.id, ...(e.form ? { form: e.form } : {}) };
      } catch (err) {
        // the film plays without an element that could not be drawn
        log(`element ${e.id} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }),
  );

  // the board's world: a backdrop drawn for its look, the floor in the same light, and the soft dot the bokeh is made of
  let set: CinematicInput['set'];
  if (board.set) {
    try {
      const size = ASPECT_SIZES[film.aspect];
      const art = await renderBackdrop({ look: board.set.look, ratio: size.width / size.height, ...(board.tone ? { tone: board.tone } : {}), ...(board.key ? { key: board.key } : {}), ...(board.set.palette ? { palette: board.set.palette } : {}) });
      const bd = await ctx.assets.put(art.png, 'image/png', { role: 'plate', width: art.width, height: art.height });
      const backdrop = { id: bd.id, src: ctx.assets.url(bd.id), width: art.width, height: art.height };
      let dot: { id: string; src: string; width: number; height: number } | undefined;
      if (board.set.air === 'bokeh') {
        const d = await renderDot();
        const da = await ctx.assets.put(d.png, 'image/png', { role: 'cutout', width: d.width, height: d.height });
        dot = { id: da.id, src: ctx.assets.url(da.id), width: d.width, height: d.height };
      }
      set = { look: board.set.look, air: board.set.air, backdrop, ground: groundColor(board.set.look, board.tone, board.key, board.set.palette), ...(dot ? { dot } : {}), skyLuma: await topLuma(art.png) };
    } catch (err) {
      log(`set not drawn: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const bed = await ctx.assets.put(await readFile(new URL('./media/bed.wav', import.meta.url)), 'audio/wav', { role: 'audio' }).catch(() => undefined);
  return { title, aspect: film.aspect, prep, accent: accent.chroma > 0.05 ? accent.hex : FALLBACK_ACCENT, board, ...(body ? { body } : {}), ingredients, set, ...(bed ? { bed: { id: bed.id, url: bed.url } } : {}) };
}

/** Makes the slow parts of a cinematic film (3D product, board, element pictures, set, music); undefined when there is no photo or the product cannot be cut out. */
export const prepareCinematicParts = (ctx: ToolCtx, log: (line: string) => void, o: { seconds?: number } = {}): Promise<CinematicParts | undefined> => prepareParts(ctx, log, o);

/** The film as the pipeline builds it from a board and the parts made for it. A price, when the brief names one, lands on the end card. */
export function buildCinematic(ctx: ToolCtx, parts: CinematicParts, board: CinematicBoard, prices?: { price: number; was?: number }): AepCompositionJson {
  const { prep, set, bed, title } = parts;
  const flat = prep.shape === 'other';
  // a board that names a form decides the body; otherwise the form found when the parts were made
  const body = board.body?.form ? board.body : (parts.body ?? board.body);
  const t = prep.texture;
  return buildCinematicFilm({
    aspect: parts.aspect,
    sheet: board.sheet,
    ...(board.tone ? { tone: board.tone } : {}),
    ...(board.key ? { key: board.key } : {}),
    texture: { id: t.id, src: ctx.assets.url(t.id), width: t.width ?? 2048, height: t.height ?? 1024, kind: prep.textureKind },
    shape: prep.shape,
    side: prep.side,
    productAspect: prep.aspect,
    ...(flat ? { contour: prep.contour!, ...(prep.focus ? { focus: prep.focus } : {}) } : {}),
    ...(set ? { set } : {}),
    ...(board.tagline ? { tagline: board.tagline } : {}),
    ...(board.handheld !== undefined ? { handheld: board.handheld } : {}),
    ...(board.finish ? { finish: board.finish } : {}),
    ...(board.endCard ? { endCard: board.endCard } : {}),
    ...(board.light ? { light: board.light } : {}),
    ...(body ? { body } : {}),
    ...(board.surface ? { surface: board.surface } : {}),
    ...(board.blur !== undefined ? { blur: board.blur } : {}),
    ...(board.grade ? { grade: board.grade } : {}),
    ...(board.bokeh !== undefined ? { bokeh: board.bokeh } : {}),
    ...(board.reflect ? { reflect: board.reflect } : {}),
    ...(board.spots?.length ? { spots: board.spots } : {}),
    ...(board.aperture !== undefined ? { aperture: board.aperture } : {}),
    ...(bed ? { music: { id: bed.id, src: bed.url } } : {}),
    title,
    ...(prices ? { price: prices.price, ...(prices.was !== undefined ? { wasPrice: prices.was } : {}) } : {}),
    currency: 'USD',
    accent: parts.accent,
    ingredients: parts.ingredients,
  });
}

/**
 * Starts the slow part of the cut (cut-out, board, element pictures, set) as the film starts, so it runs while the crew builds and the
 * finish only assembles. Any brief with a product photo gets it; a price, when the brief names one, lands on the end card. Never throws.
 */
export function startCinematic(ctx: ToolCtx, briefText: string, log: (line: string) => void = () => {}): void {
  // the fake director makes no Meta calls, and the cut is all Meta calls (board, cut-out, element pictures)
  if (process.env.CINEMATIC_CUT === '0' || isFakeDirector() || early.has(ctx.filmId)) return;
  const p = prepareParts(ctx, log).catch((err) => {
    log(`cinematic prep failed: ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  });
  early.set(ctx.filmId, p);
}

/**
 * The cinematic cut of a product film: Muse writes a board from the photo, each element is drawn once, and the film is built as one
 * stage3d world with a real camera (push, pull, orbit, dolly-zoom, truck), element splashes, the board's set and an animated price end card.
 * A round pack turns in 3D; any other product is a thick cut-out that drops in and swings. Uses the parts startCinematic began, when it did.
 * Returns false, and changes nothing, when the film has no photo or the product cannot be cut out: the 2D film then stands. Without a price
 * in the brief the end card carries the name and tagline alone.
 */
export async function cinematicCut(ctx: ToolCtx, log: (line: string) => void = () => {}): Promise<boolean> {
  if (isFakeDirector()) return false;
  const film = await ctx.films.get(ctx.filmId);
  const words = [film.brief.text, ...(film.storyboard?.scenes.map((s) => s.text ?? '') ?? [])].join(' ');
  const prices = pricesIn(words);
  const pending = early.get(ctx.filmId);
  early.delete(ctx.filmId);
  const parts = (pending ? await pending : undefined) ?? (await prepareParts(ctx, log));
  if (!parts) return false;
  const { prep, board, title } = parts;
  if (board.form === '2d' && !choosesFlat(board)) log(`Muse wrote 2D but its own traits (${JSON.stringify(board.traits ?? {})}) give no reason for it; the 3D film is built`);
  if (choosesFlat(board)) {
    // Muse read the photo as a soft or lying product the solid 3D body would spoil, so the 2D film stays
    log(`2D film kept: Muse chose it (${board.traits ? JSON.stringify(board.traits) : 'no traits'}); ${board.concept}`.slice(0, 400));
    return false;
  }
  const flat = prep.shape === 'other';

  const build = (b: CinematicBoard) => buildCinematic(ctx, parts, b, prices);
  let comp = build(board);
  let flatCut: AepCompositionJson | undefined;
  let keep: '2d' | '3d' = '3d';
  if (reviewEnabled()) {
    // Muse looks at six frames of what it wrote and may revise the board once; the pictures it needs are already made
    const photoRef = film.assets.find((a) => a.role === 'product-photo');
    const photo = photoRef ? await ctx.assets.read(photoRef.id).catch(() => undefined) : undefined;
    const seen = await reviewFrames(ctx, { board, title, brief: film.brief.text, ...(photo ? { photo } : {}), flat, render: (times, revised) => renderKeyFrames(revised ? build(revised) : comp, times), log });
    if (seen.revised) comp = build(seen.board);
    // a last look: Muse sees both cuts, and the film goes back to its 2D cut only when that cut clearly wins (the 3D one broke the product)
    flatCut = (await finishedComposition(ctx.films, ctx.filmId, ctx.assets).catch(() => undefined)) as AepCompositionJson | undefined;
    if (flatCut) {
      const twoD = flatCut;
      const at = (c: { durationInFrames: number; fps: number }, shares: readonly number[]) => shares.map((x) => Math.round(((x * c.durationInFrames) / c.fps) * 100) / 100);
      const pick = await pickForm(ctx, {
        filmId: ctx.filmId,
        title,
        brief: film.brief.text,
        ...(photo ? { photo } : {}),
        render2d: (shares) => renderKeyFrames(twoD, at(twoD, shares), undefined, 2000),
        render3d: (shares) => renderKeyFrames(comp, at(comp as { durationInFrames: number; fps: number }, shares)),
        log,
      });
      log(`2D or 3D: Muse found ${pick.better === 'tie' ? 'a tie' : `the ${pick.better.toUpperCase()} cut better${pick.clear ? ' by a clear margin' : ', but only slightly'}`}${pick.why ? `: ${pick.why}` : ''}`);
      if (!keeps3d(pick)) {
        log('the 2D film stays: its cut clearly beat the 3D one (the 3D cut is kept one version back)');
        keep = '2d';
      }
    }
  }
  // both cuts are saved, the one not chosen one step back in the film's history
  return commitCuts(ctx.films, ctx.filmId, { ...(flatCut ? { flat: flatCut } : {}), solid: comp as AepCompositionJson, keep, log });
}
