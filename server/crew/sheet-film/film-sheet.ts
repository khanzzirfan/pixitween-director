import type { Buffer } from 'node:buffer';
import type { ToolCtx } from '@shared/tools';
import { emitAsset } from '../../art/events';
import { planBoard, reviewBoard, type CinematicBoard } from '../../authoring/beatsheet';
import type { Idea } from '../../authoring/pitch';
import type { Comp } from '../../authoring/types';
import { measureFrames, parseCritique } from '../frame-review';
import { composeSheet } from './compose';
import { leavingAt, wordContrast, wordTimes } from './words';

// The film as one labelled sheet: two frames for every shot in reading order (just in and just before it leaves, so every cut is seen as the
// out frame of one shot beside the in frame of the next), what the code measured, and one look by Muse that may change the board once. The creative choices stay with Muse; this file draws, measures, asks and keeps the elements and the set.

/** One frame of the last shot's end, so the end card is seen as it holds. */
const FRAME = 1 / 30;
/** How far into a shot its in frame is, and how far before its end its out frame is: a share of the shot, at most these seconds, so a shader cut's own blend is mostly over. */
const IN_AT = { share: 0.2, max: 0.4 };
const OUT_AT = { share: 0.15, max: 0.3 };
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Two frames for every shot: just in, and just before it leaves (the last shot's out frame is its very end, the end card). Seconds, ascending. */
export function filmSheetTimes(board: CinematicBoard): number[] {
  const out: number[] = [];
  let clock = 0;
  const beats = board.sheet.beats;
  for (const [i, b] of beats.entries()) {
    out.push(round2(clock + Math.min(IN_AT.max, b.seconds * IN_AT.share)));
    out.push(i === beats.length - 1 ? round2(clock + b.seconds - FRAME) : round2(clock + b.seconds - Math.min(OUT_AT.max, b.seconds * OUT_AT.share)));
    clock += b.seconds;
  }
  return out;
}

/** A label for each frame of filmSheetTimes: 'shot 2 in [2.6s] medium orbit, after a hard cut' and 'shot 2 out [4.7s]', with the shot's words in quotes on its in frame. */
export function filmSheetLabels(board: CinematicBoard): string[] {
  const times = filmSheetTimes(board);
  return board.sheet.beats.flatMap((b, i) => [
    `shot ${i + 1} in [${times[2 * i]!.toFixed(1)}s] ${b.size} ${b.move}${i ? `, after a ${b.cut ?? 'hard'} cut` : ''}${b.text ? ` "${b.text}"` : ''}`,
    `shot ${i + 1} ${i === board.sheet.beats.length - 1 ? 'end card' : 'out'} [${times[2 * i + 1]!.toFixed(1)}s]`,
  ]);
}

/** '[0.0-1.2s] wide push, hard cut' for each shot, with its words in quotes when it has some. */
export function shotLines(board: CinematicBoard): string[] {
  let clock = 0;
  return board.sheet.beats.map((b) => {
    const angle = b.angle ? `, ${b.angle} angle` : '';
    const line = `[${clock.toFixed(1)}-${(clock + b.seconds).toFixed(1)}s] ${b.size} ${b.move}${angle}, ${b.cut ?? 'hard'} cut${b.text ? ` "${b.text}"` : ''}`;
    clock += b.seconds;
    return line;
  });
}

type BoardSet = NonNullable<CinematicBoard['set']>;

/** The set a revision may change: its look and air stay (the elements and air were drawn for them), its colours are the revision's when it wrote some. */
export function keptSet(was: BoardSet, revised: BoardSet | undefined): BoardSet {
  return revised?.palette ? { ...was, palette: revised.palette } : was;
}

/** Whether the set's picture would come out differently: its palette, or the tone and key it is lit in. */
export function recoloured(a: CinematicBoard, b: CinematicBoard): boolean {
  return JSON.stringify(a.set?.palette ?? null) !== JSON.stringify(b.set?.palette ?? null) || a.tone !== b.tone || a.key !== b.key;
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
export function filmLookPrompt(o: { board: CinematicBoard; title: string; measured: string[]; photo: boolean; idea?: Idea }): string {
  const shots = shotLines(o.board).map((l, i) => `${i + 1}. ${l}`);
  const sheet = 'the film sheet: two frames for every shot in reading order, each labelled (the frame just after the shot starts, then the frame just before it leaves), so each cut is the out frame of one shot beside the in frame of the next; the last frame is the end card';
  return [
    `You wrote the board for a 3D product film of "${o.title}": "${o.board.concept}" (${o.board.mood}).`,
    ...(o.idea ? [`The idea you chose for it: "${o.idea.name}"${o.idea.world ? `, set in ${o.idea.world}` : ''}${o.idea.camera ? `; the camera: ${o.idea.camera}` : ''}.`] : []),
    o.photo ? `The first picture is the real photo of the product. The second is ${sheet}.` : `The picture is ${sheet}.`,
    `The shots: ${shots.join('; ')}.`,
    ...(o.board.locks?.length ? [`Your lock lines, which must hold in every shot: ${o.board.locks.map((l) => `"${l}"`).join('; ')}.`] : []),
    ...(o.measured.length ? [`The code measured these problems: ${o.measured.join('; ')}.`] : []),
    'Look at it as the director. Is the product always clear and the hero, and the one in the photo? Is anything cropped badly, lost in the dark, burnt out or hidden behind words? Do the words read, do the lock lines hold, is the pace right, and does the last frame read as an end card? A frame labelled "words leaving" catches the words on their way out, letters going one by one: that is their exit, not a crop.',
    `Then look at it as the cinematographer. Does every shot look different from the one before it (its size, its angle, the side of the product it sees), or do two shots in a row read as the same frame, or a jump cut? Do the sizes travel, and is any shot not straight on at eye level? Does each cut have a reason you can see in the out and in frames (a match cut matches one thing across the cut and still changes the size or the angle)? Does the world on screen look like the place ${o.idea ? 'the idea names' : 'the concept needs'}, in its colours?`,
    'Name only real problems that a change to the shots, the camera, the light, the grade, the finish or the colours of the set would fix, each as one short sentence that says what to change (for example "shots 2, 3 and 4 are the same straight-on medium: make 3 a low close and 4 a macro of the berries from above"). If it works, say so.',
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
    /** the film Muse chose at the idea step: the look names it and the revision is written from it */
    idea?: Idea;
    /** paints the set again for a revised board whose colours changed (the backdrop is a picture made from the palette, tone and key) */
    restage?: (board: CinematicBoard) => Promise<void>;
  },
): Promise<FilmLook> {
  const clock = () => Date.now();
  const draw = async (board: CinematicBoard, film: Comp) => {
    const t0 = clock();
    const times = filmSheetTimes(board);
    // the words are measured on frames where they are fully in; the sheet has some, and the rest are drawn too but not shown
    const extra = wordTimes(film, times);
    const drawn = await o.render(film, [...times, ...extra]);
    const frames = drawn.slice(0, times.length);
    // an out frame that catches words on their way out says so: on 4 Nov Muse read letters leaving one by one as words cut off
    const labels = filmSheetLabels(board).map((l, i) => (leavingAt(film, times[i]!) ? `${l}, words leaving` : l));
    // two frames a shot: a row holds two shots, three when the film has many
    const sheet = await composeSheet({ title: `Film sheet: ${o.title}`, panels: frames.map((png, i) => ({ png, label: labels[i] ?? `frame ${i + 1}` })), columns: Math.min(board.sheet.beats.length > 6 ? 6 : 4, frames.length) });
    o.log(`film sheet drawn in ${Math.round((clock() - t0) / 1000)} s`);
    return { times, frames, sheet, seen: { frames: drawn, times: [...times, ...extra] } };
  };
  const wordsSeen = (d: { seen: { frames: Buffer[]; times: number[] } }, film: Comp) => wordContrast(d.seen.frames, d.seen.times, film).catch(() => [] as string[]);

  let board = o.board;
  let film = o.build(board);
  const first = await draw(board, film);
  const measured = [...(await measureFrames(first.frames, o.photo).catch(() => [])), ...o.jsonProblems(film), ...(await wordsSeen(first, film))];

  if (measured.length) o.log(`the code measured: ${measured.join('; ')}`);
  let muse: string[] = [];
  try {
    const t0 = clock();
    const reply = await ctx.meta.spark.reviewImages(o.photo ? [o.photo, first.sheet] : [first.sheet], filmLookPrompt({ board, title: o.title, measured, photo: !!o.photo, ...(o.idea ? { idea: o.idea } : {}) }));
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
      const asks = [...sheets.map((p) => `seen on the part sheets: ${p}`), ...problems.map((p) => `seen in the film sheet: ${p}`), "keep the elements and the set's look and air exactly as they are; change the shots, camera, light, grade, finish and, where the world on screen is wrong, the set's colours (set.palette)"];
      // the sheet film is always 3D, so the revision is not asked to choose 2D
      const planned = await planBoard(ctx, { title: o.title, ...(o.brief ? { brief: o.brief } : {}), ...(o.photo ? { photo: o.photo } : {}), seconds: o.askedSeconds, ...(o.flat !== undefined ? { flat: o.flat } : {}), ...(o.idea ? { idea: o.idea } : {}), solid: true, prior: { board, violations: asks } });
      if (planned.source === 'muse') {
        const merged = reviewBoard({ ...planned.board, elements: board.elements, ...(board.set ? { set: keptSet(board.set, planned.board.set) } : {}) });
        if (!merged.hard.length) {
          if (o.restage && recoloured(board, merged.board)) {
            await o.restage(merged.board);
            o.log('the set was painted again in the revised colours');
          }
          board = merged.board;
          film = o.build(board);
          const again = await draw(board, film);
          sheet = again.sheet;
          revised = true;
          left = [...o.jsonProblems(film), ...(await wordsSeen(again, film))];
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
