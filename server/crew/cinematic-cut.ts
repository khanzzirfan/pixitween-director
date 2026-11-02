import type { ToolCtx } from '@shared/tools';
import { cutout } from '../art/cutout';
import { dominantAccent } from '../art/palette';
import { planBoard, reviewBoard } from '../authoring/beatsheet';
import { prepareRound } from '../authoring/catalog-clip';
import { buildCinematicFilm } from '../authoring/cinematic-film';
import { elementKey, makeElement, type IngredientAsset } from '../authoring/ingredients';
import { newPrepareCache } from '../product3d/prepare';

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

/** A short name for the end card: the one Muse reads off the pack, else the brief's first words (a brief is a sentence, not a name). */
async function productName(ctx: ToolCtx, photo: Buffer, brief: string): Promise<string> {
  try {
    const reply = (await ctx.meta.spark.reviewImages([photo], 'Read the product name printed on this pack. Reply as JSON {"name": "<brand and product, at most 4 words, title case>"}.')) as { name?: unknown };
    ctx.ledger.add(ctx.filmId, 'muse-spark-1.3-contributor', '1 call', 0.005);
    const name = typeof reply?.name === 'string' ? reply.name.trim() : '';
    if (name && name.length <= 32) return name;
  } catch {
    /* fall through to the brief */
  }
  return brief.split(/[,.—-]/)[0]!.trim().split(/\s+/).slice(0, 4).join(' ').slice(0, 32) || 'New';
}

/**
 * The cinematic cut of a round product film (a can or a bottle): Muse writes a board from the photo, each ingredient is drawn once, and the
 * film is built as one stage3d world with a real camera (push, pull, orbit, dolly-zoom), ingredient splashes and an animated price end card.
 * Returns false, and changes nothing, when the film has no photo, no price, or the product is not a tall round pack: the 2D film then stands.
 */
export async function cinematicCut(ctx: ToolCtx, log: (line: string) => void = () => {}): Promise<boolean> {
  const film = await ctx.films.get(ctx.filmId);
  const photoRef = film.assets.find((a) => a.role === 'product-photo');
  if (!photoRef) return false;
  const words = [film.brief.text, ...(film.storyboard?.scenes.map((s) => s.text ?? '') ?? [])].join(' ');
  const prices = pricesIn(words);
  if (!prices) return false;

  const photo = await ctx.assets.read(photoRef.id);
  const cut = await cutout(ctx, { source: photo, noun: 'can', sceneId: 'cinematic' });
  const c = { id: cut.cutout.id, width: cut.cutout.width ?? 0, height: cut.cutout.height ?? 0 };
  const prep = await prepareRound(ctx.assets, c, 'can', prepared);
  if (!prep || prep.shape === 'other') return false;
  const accent = await dominantAccent(await ctx.assets.read(c.id));

  const title = await productName(ctx, photo, film.brief.text);
  const planned = await planBoard(ctx, { title, brief: film.brief.text, category: 'drinks', photo, seconds: Math.min(10, film.storyboard?.durationSec ?? 8) });
  const { board } = reviewBoard(planned.board);
  log(`board by ${planned.source}: ${board.concept}`);

  const ingredients: Record<string, IngredientAsset> = {};
  for (const e of board.elements) {
    const key = elementKey(e);
    try {
      const made = drawn.get(key) ?? (await makeElement(ctx, e, { cache: prepared }));
      drawn.set(key, made);
      ingredients[e.id] = { ...made, kind: e.id };
    } catch (err) {
      // the film plays without an element that could not be drawn
      log(`element ${e.id} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const t = prep.texture;
  const comp = buildCinematicFilm({
    aspect: film.aspect,
    sheet: board.sheet,
    ...(board.tone ? { tone: board.tone } : {}),
    ...(board.key ? { key: board.key } : {}),
    texture: { id: t.id, src: ctx.assets.url(t.id), width: t.width ?? 2048, height: t.height ?? 1024, kind: prep.textureKind },
    shape: prep.shape,
    side: prep.side,
    productAspect: prep.aspect,
    title,
    price: prices.price,
    ...(prices.was !== undefined ? { wasPrice: prices.was } : {}),
    currency: 'USD',
    accent: accent.chroma > 0.05 ? accent.hex : FALLBACK_ACCENT,
    ingredients,
  });
  const r = await ctx.films.commit(ctx.filmId, comp, 'director', 'cinematic cut: camera moves, ingredient splashes, animated price card');
  return r.ok;
}
