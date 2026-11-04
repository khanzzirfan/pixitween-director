import type { Buffer } from 'node:buffer';
import type { AepCompositionJson } from '@shared/aep';
import type { ToolCtx } from '@shared/tools';
import { choosesFlat, planBoard, reviewBoard, type CinematicBoard } from '../../authoring/beatsheet';
import type { Comp } from '../../authoring/types';
import { buildCinematic, pricesIn, prepareCinematicParts } from '../cinematic-cut';
import { commitCuts } from '../form-pick';
import { renderKeyFrames } from '../frame-review';
import { checkSheets } from './check';
import { lookAtFilm } from './film-sheet';
import { jsonRules } from './json-rules';
import { askedSeconds, storyboardFromBoard } from './plan';
import { drawSheets, type PartSheets } from './render';

// Every new product film as one 3D film: the parts, the product, element and set sheets checked once by Muse, the film built from JSON,
// checked by code rules, drawn as a film sheet and looked at once, then committed. No 2D crew and no 2D-versus-3D judging.

export type SheetFilmResult = { ok: true; seconds: Record<string, number> } | { ok: false; reason: string };

/** Makes the film, step by step, and returns the seconds every step took. A product the 3D path cannot make ends with a plain reason. */
export async function makeSheetFilm(
  ctx: ToolCtx,
  o: { log: (line: string) => void; render?: (comp: Comp, times: number[]) => Promise<Buffer[]>; now?: () => number },
): Promise<SheetFilmResult> {
  const { log } = o;
  const now = o.now ?? Date.now;
  const render = o.render ?? ((comp: Comp, times: number[]) => renderKeyFrames(comp, times));
  const seconds: Record<string, number> = { parts: 0, sheets: 0, check: 0, revise: 0, look: 0, commit: 0 };
  let t0 = now();
  const lap = (step: string) => {
    seconds[step] = Math.round((now() - t0) / 100) / 10;
    log(`${step}: ${seconds[step]} s`);
    t0 = now();
  };

  try {
    const film = await ctx.films.get(ctx.filmId);
    const asked = askedSeconds(film.brief.text);
    const prices = pricesIn([film.brief.text, ...(film.storyboard?.scenes.map((s) => s.text ?? '') ?? [])].join(' '));
    const photoRef = film.assets.find((a) => a.role === 'product-photo');
    const photo = photoRef ? await ctx.assets.read(photoRef.id).catch(() => undefined) : undefined;

    const parts = await prepareCinematicParts(ctx, log, { seconds: asked });
    if (!parts || !photo) {
      return { ok: false, reason: 'the film needs a product photo, and the product in it could not be cut out' };
    }
    lap('parts');
    let board: CinematicBoard = parts.board;
    // a flat cut-out product is told so on every board Muse writes, revisions included
    const flat = parts.prep.shape === 'other';
    if (choosesFlat(board)) log(`Muse chose a flat 2D film (${board.traits ? JSON.stringify(board.traits) : 'no traits'}); it is built in 3D anyway`.slice(0, 300));
    const build = (b: CinematicBoard): Comp => buildCinematic(ctx, parts, b, prices);
    const keepFixed = (next: CinematicBoard, from: CinematicBoard): CinematicBoard | undefined => {
      const merged = reviewBoard({ ...next, elements: from.elements, ...(from.set ? { set: from.set } : {}) });
      return merged.hard.length ? undefined : merged.board;
    };

    // the product, element and set sheets, drawn from the built film
    let sheets: PartSheets | undefined;
    try {
      sheets = await drawSheets(ctx, { film: build(board), photo, render });
      for (const why of sheets.skipped) log(`sheet skipped, the others kept: ${why}`);
    } catch (err) {
      log(`sheets skipped: ${err instanceof Error ? err.message : String(err)}`);
    }
    lap('sheets');

    // one Muse look at the sheets; what it names goes back once to the board, and an element it says is wrong leaves the film
    let problems: string[] = [];
    if (sheets) {
      try {
        const check = await checkSheets(ctx, { photo, sheets, board, title: parts.title });
        problems = check.problems;
        if (check.dropElements.length) {
          const kept = reviewBoard({ ...board, elements: board.elements.filter((e) => !check.dropElements.includes(e.id)) }, check.dropElements);
          if (kept.hard.length) log(`Muse wanted ${check.dropElements.join(', ')} dropped, but the film needs its elements`);
          else {
            board = kept.board;
            log(`dropped on Muse's word: ${check.dropElements.join(', ')}`);
          }
        }
        log(check.fine ? 'Muse kept the sheets' : `Muse saw on the sheets: ${check.problems.join('; ') || 'a wrong element'}`);
      } catch (err) {
        log(`sheet check skipped: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    lap('check');

    if (problems.length) {
      try {
        const asks = [...problems.map((p) => `seen on the sheets: ${p}`), 'keep the elements and the set exactly as they are; change only the shots, camera, light, grade and finish'];
        const planned = await planBoard(ctx, { title: parts.title, brief: film.brief.text, photo, seconds: asked, flat, prior: { board, violations: asks } });
        const next = planned.source === 'muse' ? keepFixed(planned.board, board) : undefined;
        if (next) {
          board = next;
          log(`Muse revised the board after the sheets: ${board.concept}`);
        }
      } catch (err) {
        log(`revision after the sheets skipped: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    lap('revise');

    // the film sheet and one Muse look at it, with at most one revision
    let comp: Comp = build(board);
    const rules = (c: Comp) => jsonRules(c, { askedSeconds: asked, aspect: film.aspect });
    try {
      const seen = await lookAtFilm(ctx, { board, title: parts.title, brief: film.brief.text, photo, askedSeconds: asked, flat, build, render, jsonProblems: rules, log });
      board = seen.board;
      comp = seen.film;
    } catch (err) {
      log(`film sheet look skipped: ${err instanceof Error ? err.message : String(err)}`);
    }
    lap('look');
    const left = rules(comp);
    if (left.length) log(`accepted problems: ${left.join('; ')}`);

    // only the solid film is committed: no 2D cut is kept as an alternative
    const done = await commitCuts(ctx.films, ctx.filmId, { solid: comp as AepCompositionJson, keep: '3d', log });
    if (!done) return { ok: false, reason: 'the film check refused the 3D film' };
    try {
      const storyboard = storyboardFromBoard(board, { title: parts.title, aspect: film.aspect });
      await ctx.films.update(ctx.filmId, { storyboard });
      ctx.emit({ type: 'director.storyboard', storyboard });
    } catch (err) {
      // the film is already committed; a plan panel without scenes is better than a failed film
      log(`storyboard not written: ${err instanceof Error ? err.message : String(err)}`);
    }
    lap('commit');
    return { ok: true, seconds };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
