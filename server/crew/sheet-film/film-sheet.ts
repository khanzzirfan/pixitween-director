import type { Buffer } from 'node:buffer';
import type { ToolCtx } from '@shared/tools';
import { emitAsset } from '../../art/events';
import { planBoard, reviewBoard, type CinematicBoard } from '../../authoring/beatsheet';
import type { Comp } from '../../authoring/types';
import { measureFrames, parseCritique } from '../frame-review';
import { composeSheet } from './compose';

// The film as one labelled sheet: a frame for every shot in reading order, what the code measured, and one look by Muse that may change
// the board once. The creative choices stay with Muse; this file draws, measures, asks and keeps the elements and the set.

/** One frame of the last shot's end, so the end card is seen as it holds. */
const FRAME = 1 / 30;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** The middle of each shot but the last, and the last frame of the last shot (the end card). Seconds, ascending. */
export function filmSheetTimes(board: CinematicBoard): number[] {
  const out: number[] = [];
  let clock = 0;
  const beats = board.sheet.beats;
  for (const [i, b] of beats.entries()) {
    out.push(i === beats.length - 1 ? round2(clock + b.seconds - FRAME) : round2(clock + b.seconds / 2));
    clock += b.seconds;
  }
  return out;
}

/** '[0.0-1.2s] wide push, hard cut' for each shot, with its words in quotes when it has some. */
export function filmSheetLabels(board: CinematicBoard): string[] {
  let clock = 0;
  return board.sheet.beats.map((b) => {
    const label = `[${clock.toFixed(1)}-${(clock + b.seconds).toFixed(1)}s] ${b.size} ${b.move}, ${b.cut ?? 'hard'} cut${b.text ? ` "${b.text}"` : ''}`;
    clock += b.seconds;
    return label;
  });
}

type Render = (comp: Comp, times: number[]) => Promise<Buffer[]>;

export interface FilmLook {
  board: CinematicBoard;
  film: Comp;
  sheet: Buffer;
  revised: boolean;
  problems: string[];
}

/** What Muse is asked when it looks at the film sheet beside the photo. */
export function filmLookPrompt(o: { board: CinematicBoard; title: string; measured: string[]; photo: boolean }): string {
  const shots = filmSheetLabels(o.board).map((l, i) => `${i + 1}. ${l}`);
  return [
    `You wrote the board for a 3D product film of "${o.title}": "${o.board.concept}" (${o.board.mood}).`,
    o.photo ? 'The first picture is the real photo of the product. The second is the film sheet: one frame for every shot, in reading order, the last frame the end card.' : 'The picture is the film sheet: one frame for every shot, in reading order, the last frame the end card.',
    `The shots: ${shots.join('; ')}.`,
    ...(o.board.locks?.length ? [`Your lock lines, which must hold in every shot: ${o.board.locks.map((l) => `"${l}"`).join('; ')}.`] : []),
    ...(o.measured.length ? [`The code measured these problems: ${o.measured.join('; ')}.`] : []),
    'Look at it as the director. Is the product always clear and the hero, and the one in the photo? Is anything cropped badly, lost in the dark, burnt out or hidden behind words? Do the words read, do the lock lines hold, is the pace right, and does the last frame read as an end card?',
    'Name only real problems that a change to the shots, the camera, the light, the grade or the finish would fix, each as one short sentence that says what to change. If it works, say so.',
    'Reply as JSON: {"fine":true|false,"problems":["..."]} with at most 4 problems.',
  ].join('\n');
}

/**
 * Builds the film from the board, draws the film sheet, measures it, shows Muse the sheet once and, if Muse or the code names problems, asks
 * for one revised board (no second look) and draws the sheet again. A floor board or a failed call keeps the first board. The final sheet is
 * saved as a film asset (role 'sheet').
 */
export async function lookAtFilm(
  ctx: ToolCtx,
  o: {
    board: CinematicBoard;
    title: string;
    brief?: string;
    photo?: Buffer;
    askedSeconds: number;
    flat?: boolean;
    build: (b: CinematicBoard) => Comp;
    render: Render;
    jsonProblems: (c: Comp) => string[];
    log: (line: string) => void;
    /** what Muse saw on the part sheets: mended in this one revision, so the film costs one board call, not two */
    fromSheets?: string[];
  },
): Promise<FilmLook> {
  const clock = () => Date.now();
  const draw = async (board: CinematicBoard, film: Comp) => {
    const t0 = clock();
    const times = filmSheetTimes(board);
    const frames = await o.render(film, times);
    const labels = filmSheetLabels(board);
    const sheet = await composeSheet({ title: `Film sheet: ${o.title}`, panels: frames.map((png, i) => ({ png, label: labels[i] ?? `frame ${i + 1}` })), columns: Math.min(3, frames.length) });
    o.log(`film sheet drawn in ${Math.round((clock() - t0) / 1000)} s`);
    return { frames, sheet };
  };

  let board = o.board;
  let film = o.build(board);
  const first = await draw(board, film);
  const measured = [...(await measureFrames(first.frames, o.photo).catch(() => [])), ...o.jsonProblems(film)];

  let muse: string[] = [];
  try {
    const t0 = clock();
    const reply = await ctx.meta.spark.reviewImages(o.photo ? [o.photo, first.sheet] : [first.sheet], filmLookPrompt({ board, title: o.title, measured, photo: !!o.photo }));
    ctx.ledger.add(ctx.filmId, 'muse-spark-1.3-contributor', 'film sheet look', 0.005);
    muse = parseCritique(reply).problems;
    o.log(`Muse looked at the film sheet in ${Math.round((clock() - t0) / 1000)} s${muse.length ? `: ${muse.join('; ')}` : ' and kept the board'}`);
  } catch (err) {
    o.log(`film sheet look skipped: ${err instanceof Error ? err.message : String(err)}`);
  }

  const sheets = o.fromSheets ?? [];
  const problems = [...muse, ...measured].slice(0, 8);
  let sheet = first.sheet;
  let revised = false;
  let left = problems;
  if (problems.length || sheets.length) {
    const t0 = clock();
    try {
      const asks = [...sheets.map((p) => `seen on the part sheets: ${p}`), ...problems.map((p) => `seen in the film sheet: ${p}`), 'keep the elements and the set exactly as they are; change only the shots, camera, light, grade and finish'];
      const planned = await planBoard(ctx, { title: o.title, ...(o.brief ? { brief: o.brief } : {}), ...(o.photo ? { photo: o.photo } : {}), seconds: o.askedSeconds, ...(o.flat !== undefined ? { flat: o.flat } : {}), prior: { board, violations: asks } });
      if (planned.source === 'muse') {
        const merged = reviewBoard({ ...planned.board, elements: board.elements, ...(board.set ? { set: board.set } : {}) });
        if (!merged.hard.length) {
          board = merged.board;
          film = o.build(board);
          sheet = (await draw(board, film)).sheet;
          revised = true;
          left = o.jsonProblems(film);
          o.log(`Muse revised the board after the film sheet in ${Math.round((clock() - t0) / 1000)} s: ${board.concept}`);
        }
      }
    } catch (err) {
      o.log(`revision after the film sheet skipped: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const ref = await ctx.assets.put(sheet, 'image/jpeg', { role: 'sheet' });
  emitAsset(ctx, ref);
  return { board, film, sheet, revised, problems: left };
}
