import type { Buffer } from 'node:buffer';
import type { ToolCtx } from '@shared/tools';
import type { CinematicBoard } from '../../authoring/beatsheet';
import type { PartSheets } from './render';

export interface SheetCheck {
  fine: boolean;
  problems: string[];
  /** ids of board elements Muse says are wrong and should leave the film */
  dropElements: string[];
}

const SHEET_NAMES: Array<[keyof Pick<PartSheets, 'product' | 'elements' | 'set'>, string]> = [
  ['product', 'the product sheet (the photo, the 3D product front, 3/4, side and back, the label close-up, colour swatches)'],
  ['elements', 'the element sheet (each element alone)'],
  ['set', 'the set sheet (the empty set wide and from the reverse, with colour swatches)'],
];

/** The names of the sheets present, in the order they are shown after the photo. */
export const namesOf = (s: PartSheets): string[] => SHEET_NAMES.filter(([k]) => s[k]).map(([, n]) => n);

/** What Muse is asked when it looks at the part sheets beside the photo. `sheets` names the sheets shown, in order, after the photo. */
export function sheetCheckPrompt(o: { board: CinematicBoard; title: string; sheets: string[] }): string {
  const ids = o.board.elements.map((e) => `${e.id} (${e.name})`);
  return [
    `You wrote the board for a 3D product film of "${o.title}": "${o.board.concept}" (${o.board.mood}). Before the film is built, here are its parts drawn by the 3D engine.`,
    `The first picture is the real photo of the product. The next pictures are, in order: ${o.sheets.join('; ')}.`,
    `The elements on your board: ${ids.length ? ids.join(', ') : 'none'}.`,
    ...(o.board.locks?.length ? [`Your lock lines, which must hold in every shot: ${o.board.locks.map((l) => `"${l}"`).join('; ')}.`] : []),
    'Check four things. Does the 3D product match the photo (its shape, its label and the colours: compare the swatches)? Is each element what the board names it? Does the set read as the look and light of the board? Do the lock lines hold?',
    'The sheets are lit neutrally on grey, so a paler or greyer look than the photo is the sheet light, not a fault: judge hue and shape, not brightness. The set sheet is empty on purpose, and dark is fine if the board asks for a dark mood. Pictures are fixed: the board cannot repaint a label or an element, so smeared edges at 90 degrees are not a problem to name. Name only what the board can change: the product\'s form or depth, an element\'s form, the wrong element, the grade or light.',
    'Name only real problems, each as one short sentence that says what is wrong and what to change. If an element is plainly wrong and cannot be mended, list its id in "dropElements".',
    'Reply as JSON: {"fine":true|false,"problems":["..."],"dropElements":["element id"]} with at most 6 problems.',
  ].join('\n');
}

/** Reads Muse's reply. The check never blocks a film: an unreadable reply counts as fine. */
export function parseSheetCheck(raw: unknown, elementIds: string[]): SheetCheck {
  const fine: SheetCheck = { fine: true, problems: [], dropElements: [] };
  let v: unknown = raw;
  if (typeof raw === 'string') {
    try {
      v = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ''));
    } catch {
      return fine;
    }
  }
  if (v === null || typeof v !== 'object') return fine;
  const o = v as { fine?: unknown; problems?: unknown; dropElements?: unknown };
  const problems = Array.isArray(o.problems) ? o.problems.filter((p): p is string => typeof p === 'string' && p.trim().length > 0).map((p) => p.trim().slice(0, 300)).slice(0, 6) : [];
  const dropElements = Array.isArray(o.dropElements) ? [...new Set(o.dropElements.filter((d): d is string => typeof d === 'string' && elementIds.includes(d)))] : [];
  return { fine: (o.fine === true && !dropElements.length) || (problems.length === 0 && !dropElements.length), problems, dropElements };
}

/** One Muse look at the part sheets beside the photo: one image call, one ledger line of 0.005 USD. */
export async function checkSheets(ctx: ToolCtx, o: { photo: Buffer; sheets: PartSheets; board: CinematicBoard; title: string }): Promise<SheetCheck> {
  const shown = [o.sheets.product, o.sheets.elements, o.sheets.set].filter((b): b is Buffer => !!b);
  const reply = await ctx.meta.spark.reviewImages([o.photo, ...shown], sheetCheckPrompt({ board: o.board, title: o.title, sheets: namesOf(o.sheets) }));
  ctx.ledger.add(ctx.filmId, 'muse-spark-1.3-contributor', 'sheet check', 0.005);
  return parseSheetCheck(reply, o.board.elements.map((e) => e.id));
}
