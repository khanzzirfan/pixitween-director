import type { Buffer } from 'node:buffer';
import type { AepCompositionJson } from '@shared/aep';
import { SHEET_STEPS, type SheetStepId } from '@shared/crew';
import type { ToolCtx } from '@shared/tools';
import { choosesFlat, reviewBoard, type CinematicBoard } from '../../authoring/beatsheet';
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
// checked by code rules, drawn as a film sheet and looked at once, at most one board revision for both looks, then committed. No 2D crew and no 2D-versus-3D judging.

export type SheetFilmResult = { ok: true; seconds: Record<string, number> } | { ok: false; reason: string };

/** Makes the film, step by step, and returns the seconds every step took. A product the 3D path cannot make ends with a plain reason. */
export async function makeSheetFilm(
  ctx: ToolCtx,
  o: { log: (line: string) => void; render?: (comp: Comp, times: number[]) => Promise<Buffer[]>; now?: () => number },
): Promise<SheetFilmResult> {
  const { log } = o;
  const now = o.now ?? Date.now;
  const render = o.render ?? ((comp: Comp, times: number[]) => renderKeyFrames(comp, times));
  const seconds: Record<string, number> = { parts: 0, sheets: 0, check: 0, look: 0, commit: 0 };
  let t0 = now();
  // who is busy on which step, as crew events: the plan pane and the crew map read these, so a long Muse call is not silence
  const crewOn = (step: SheetStepId) => {
    const label = SHEET_STEPS.find((s) => s.id === step)?.label ?? step;
    const watching = step === 'check' || step === 'look';
    ctx.emit({ type: 'crew.agent', lane: 'showrunner', worker: 'showrunner', state: watching ? 'waiting' : 'working', note: label });
    ctx.emit({ type: 'crew.agent', lane: 'critic', worker: 'critic', state: watching ? 'thinking' : 'idle', ...(watching ? { note: label } : {}) });
  };
  const crewOff = () => {
    ctx.emit({ type: 'crew.agent', lane: 'showrunner', worker: 'showrunner', state: 'idle' });
    ctx.emit({ type: 'crew.agent', lane: 'critic', worker: 'critic', state: 'idle' });
  };
  crewOn('parts');
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
    crewOn('sheets');
    let board: CinematicBoard = parts.board;
    // a flat cut-out product is told so on every board Muse writes, revisions included
    const flat = parts.prep.shape === 'other';
    if (choosesFlat(board)) log(`Muse chose a flat 2D film (${board.traits ? JSON.stringify(board.traits) : 'no traits'}); it is built in 3D anyway`.slice(0, 300));
    const build = (b: CinematicBoard): Comp => buildCinematic(ctx, parts, b, prices);

    // the product, element and set sheets, drawn from the built film
    let sheets: PartSheets | undefined;
    try {
      sheets = await drawSheets(ctx, { film: build(board), photo, render, ...(parts.turnaround ? { turnaround: parts.turnaround } : {}) });
      for (const why of sheets.skipped) log(`sheet skipped, the others kept: ${why}`);
    } catch (err) {
      log(`sheets skipped: ${err instanceof Error ? err.message : String(err)}`);
    }
    lap('sheets');
    crewOn('check');

    // one Muse look at the sheets: an element it says is wrong leaves the film now, and what else it names is mended in the one revision
    // after the film sheet (a revision here as well cost a 50 s board call and rarely changed the board)
    let problems: string[] = [];
    if (sheets) {
      try {
        const check = await checkSheets(ctx, { photo, sheets, board, title: parts.title, ...(parts.turnaround ? { drawnBack: true } : {}) });
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

    crewOn('look');

    // the film sheet and one Muse look at it, with at most one revision, which also mends what the part sheets showed
    let comp: Comp = build(board);
    const rules = (c: Comp) => jsonRules(c, { askedSeconds: asked, aspect: film.aspect });
    try {
      const seen = await lookAtFilm(ctx, { board, title: parts.title, brief: film.brief.text, photo, askedSeconds: asked, flat, build, render, jsonProblems: rules, log, fromSheets: problems });
      board = seen.board;
      comp = seen.film;
    } catch (err) {
      log(`film sheet look skipped: ${err instanceof Error ? err.message : String(err)}`);
    }
    lap('look');
    crewOn('commit');
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
  } finally {
    crewOff();
  }
}
