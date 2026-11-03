import type { Buffer } from 'node:buffer';
import type { AepCompositionJson } from '@shared/aep';
import type { FilmStore } from '@shared/ports';
import type { ToolCtx } from '@shared/tools';

// A last look before the 3D film replaces the 2D one. Both are drawn at the same share of their length, Muse is shown the product photo and the two
// sets side by side (which set comes first is fixed per film, not always 3D first, so its order does not lean the choice), and it says which is the
// better ad and whether by a clear margin. The owner prefers the 3D world (a real camera, light and set round the product), and the 2D cut always
// wins on looking like the photo because it is the photo, so the 3D film stays unless the 2D cut wins clearly: the look only catches a 3D cut that
// breaks the product. Soft or lying products the 3D body spoils never get here: Muse sends them to 2D from their traits (choosesFlat).

/** How many frames of each film Muse is shown. */
export const PICK_FRAMES = 5;

/** The moments to look at, as shares of each film's length: spread over the film, the last one near the end card. */
export const PICK_SHARES = [0.12, 0.32, 0.52, 0.72, 0.95] as const;

export interface FormPick {
  /** Muse's choice, read as which form it is, whatever order the sets were shown in. */
  better: '2d' | '3d' | 'tie';
  clear: boolean;
  why: string;
}

/** Whether the 3D film should replace the 2D one: always, unless the 2D cut wins by a clear margin. */
export const keeps3d = (p: FormPick): boolean => !(p.better === '2d' && p.clear);

/** Which set is shown first (A): fixed per film by its id so a rerun shows the same order, and about half of all films see 3D first. */
export function threeDFirst(filmId: string): boolean {
  let h = 0;
  for (const ch of filmId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 2 === 0;
}

export function pickPrompt(o: { title: string; brief?: string; withPhoto: boolean }): string {
  const first = o.withPhoto ? 'The first picture is the real product photo. ' : '';
  const a = o.withPhoto ? `pictures 2 to ${PICK_FRAMES + 1}` : `pictures 1 to ${PICK_FRAMES}`;
  const b = o.withPhoto ? `pictures ${PICK_FRAMES + 2} to ${2 * PICK_FRAMES + 1}` : `pictures ${PICK_FRAMES + 1} to ${2 * PICK_FRAMES}`;
  return [
    `Two cuts of the same short ad for ${o.title}${o.brief ? ` (brief: ${o.brief.slice(0, 300)})` : ''}. ${first}Film A is ${a}, film B is ${b}, each in order from start to end card.`,
    'Judge them as the client would. The client loves a cinematic 3D world: a real camera, light, water, splashes and a set round the product. One cut is that 3D world; the other plays the product photo itself in 2D, so it always looks exactly like the photo: do not prefer it for that. Prefer the 3D world unless it breaks the product: a wrong shape, wrong colours, a label you cannot read in any frame, the product burnt out, lost, cut off or hidden for most of the film, or an end card that does not read. Small changes of sheen, tint or angle are not breaks.',
    'Answer only JSON: {"better":"A|B|tie","clear":true|false,"why":"one sentence"}. clear is true only when the better film wins by a margin anyone would see.',
  ].join('\n');
}

/** Muse's answer, mapped from A/B to the forms. Anything unreadable is a tie (so the 3D film stays). */
export function parsePick(raw: unknown, aIs3d: boolean): FormPick {
  let v: unknown = raw;
  if (typeof v === 'string') {
    const m = v.match(/\{[\s\S]*\}/);
    try {
      v = m ? JSON.parse(m[0]) : undefined;
    } catch {
      v = undefined;
    }
  }
  const o = (v && typeof v === 'object' ? v : {}) as { better?: unknown; clear?: unknown; why?: unknown };
  const letter = typeof o.better === 'string' ? o.better.trim().toUpperCase() : '';
  const better = letter === 'A' ? (aIs3d ? '3d' : '2d') : letter === 'B' ? (aIs3d ? '2d' : '3d') : 'tie';
  return { better, clear: o.clear === true, why: typeof o.why === 'string' ? o.why.slice(0, 300) : '' };
}

export interface PickInput {
  filmId: string;
  title: string;
  brief?: string;
  photo?: Buffer;
  /** Draws a film at these shares of its length. */
  render2d: (shares: readonly number[]) => Promise<Buffer[]>;
  render3d: (shares: readonly number[]) => Promise<Buffer[]>;
  log?: (line: string) => void;
}

/**
 * Shows Muse both films and returns its pick. When the frames cannot be drawn or Muse cannot be asked the 3D film is kept, as it was before this
 * check: the check only ever takes a film back to its 2D cut on Muse's word.
 */
export async function pickForm(ctx: ToolCtx, o: PickInput): Promise<FormPick> {
  const log = o.log ?? (() => {});
  try {
    const [flat, solid] = await Promise.all([o.render2d(PICK_SHARES), o.render3d(PICK_SHARES)]);
    if (flat.length !== PICK_FRAMES || solid.length !== PICK_FRAMES) return { better: '3d', clear: true, why: 'frames could not be drawn' };
    const aIs3d = threeDFirst(o.filmId);
    const images = [...(o.photo ? [o.photo] : []), ...(aIs3d ? solid : flat), ...(aIs3d ? flat : solid)];
    const raw = await ctx.meta.spark.reviewImages(images, pickPrompt({ title: o.title, ...(o.brief ? { brief: o.brief } : {}), withPhoto: Boolean(o.photo) }));
    ctx.ledger.add(ctx.filmId, 'muse-spark-1.3-contributor', '2D or 3D pick', 0.006);
    return parsePick(raw, aIs3d);
  } catch (err) {
    log(`2D or 3D pick skipped: ${err instanceof Error ? err.message : String(err)}`);
    return { better: '3d', clear: true, why: 'pick skipped' };
  }
}

export interface Cuts {
  /** The 2D cut as the finish would make it. Absent when it could not be built: the 3D cut is then the only one. */
  flat?: AepCompositionJson;
  solid: AepCompositionJson;
  /** Which cut the film plays. */
  keep: '2d' | '3d';
  log?: (line: string) => void;
}

/**
 * Commits both cuts, the one not chosen first, so the film plays the chosen one and the other sits one step back in its history (undo shows it,
 * redo comes back). Returns whether the film is settled; false leaves the 2D finish to the caller. Never leaves a refused cut as the head.
 */
export async function commitCuts(films: FilmStore, filmId: string, o: Cuts): Promise<boolean> {
  const log = o.log ?? (() => {});
  const note3d = 'cinematic cut: camera moves, element splashes, animated price card';
  const note2d = 'finish: shadow, grade, type, music';
  if (!o.flat) {
    const r = await films.commit(filmId, o.solid, 'director', note3d);
    if (!r.ok) log(`cinematic cut refused by the film check: ${JSON.stringify(r.issues).slice(0, 400)}`);
    return r.ok;
  }
  const [first, second] = o.keep === '3d' ? ([o.flat, o.solid] as const) : ([o.solid, o.flat] as const);
  const notes = o.keep === '3d' ? [`alternative cut, not chosen: the 2D film (${note2d})`, note3d] : [`alternative cut, not chosen: the 3D film (${note3d})`, `${note2d} (kept over the 3D cut)`];
  const a = await films.commit(filmId, first, 'director', notes[0]);
  if (!a.ok) log(`the alternative cut was not kept (refused by the film check): ${JSON.stringify(a.issues).slice(0, 200)}`);
  const b = await films.commit(filmId, second, 'director', notes[1]);
  if (b.ok) return true;
  log(`the ${o.keep === '3d' ? '3D' : '2D'} cut was refused by the film check: ${JSON.stringify(b.issues).slice(0, 400)}`);
  // a refused 3D cut leaves the finished 2D cut as the head, which is a whole film; a refused 2D cut leaves the 3D cut there, so step back off it and leave the 2D finish to the caller
  if (o.keep === '3d') return a.ok;
  if (a.ok) await films.undo(filmId).catch(() => undefined);
  return false;
}
