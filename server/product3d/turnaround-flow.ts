// The whole turnaround for one product: draw, split, check by code, check by Muse, redraw once, or fall back. A turnaround never fails a film.
import type { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import type { ToolCtx } from '@shared/tools';
import { cutout } from '../art/cutout';
import { loadEnv } from '../env';
import { viewsAgree, type AgreeScores } from './agree';
import { drawTurnaround, splitTurnaround, type TurnaroundViews } from './turnaround';
import { checkTurnaround } from './turnaround-check';

export interface TurnaroundResult {
  views: TurnaroundViews;
  /** the drawn sheet, as shown in the Plan panel; absent when the back is a supplied photo */
  sheet?: Buffer;
  /** the product's depth as a share of its width, read from the drawn side; absent when nothing was drawn */
  depthShare?: number;
}

/** Drawn once per photo in this process, so a line-up of one product pays once. A failure is not kept. */
const done = new Map<string, Promise<TurnaroundResult>>();
export const clearTurnaroundCache = (): void => done.clear();

/**
 * One Muse look at the product photo and the film's other pictures: is one of them the back of the same product? Pictures are numbered from 0 in the order
 * sent (the photo is 0). A named picture is cut out and returned; otherwise undefined.
 */
export async function suppliedBack(ctx: ToolCtx, o: { photo: Buffer; others: Buffer[]; noun: string }): Promise<Buffer | undefined> {
  if (!o.others.length) return undefined;
  const reply = await ctx.meta.spark.reviewImages(
    [o.photo, ...o.others],
    [
      `The pictures are numbered from 0 in the order shown. Picture 0 is the product photo (a ${o.noun}).`,
      'Which other picture, if any, shows the BACK of the same product (the same physical item turned round, not another product, not the front again)?',
      'Reply as JSON: {"back": <picture number>} or {"back": null}.',
    ].join('\n'),
  );
  ctx.ledger.add(ctx.filmId, 'muse-spark-1.3-contributor', 'back photo check', 0.005);
  let index: unknown = (reply as { back?: unknown } | null)?.back;
  if (typeof reply === 'string') {
    const found = reply.match(/\{[\s\S]*\}/);
    try {
      index = found ? (JSON.parse(found[0]) as { back?: unknown }).back : undefined;
    } catch {
      index = undefined;
    }
  }
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 1 || index > o.others.length) return undefined;
  const source = o.others[index - 1]!;
  const cut = await cutout(ctx, { source, noun: o.noun, sceneId: 'cinematic' }).catch(() => undefined);
  return cut ? ctx.assets.read(cut.cutout.id) : undefined;
}

type Attempt = { ok: true; result: TurnaroundResult } | { ok: false; problems: string[] };

/** What one drawing came to, pass or fail: for the debug folder of a live run. */
export interface TurnaroundAttempt {
  n: number;
  sheet: Buffer;
  views?: TurnaroundViews;
  scores?: AgreeScores;
  problems: string[];
  passed: boolean;
}

async function attempt(ctx: ToolCtx, o: TurnaroundInput & { n: number; extra?: string[] }): Promise<Attempt> {
  const drawn = await drawTurnaround(ctx, { cut: o.cut, photo: o.photo, what: o.what, ...(o.extra ? { extra: o.extra } : {}) });
  const seen = (a: Omit<TurnaroundAttempt, 'n' | 'sheet'>) => o.onAttempt?.({ n: o.n, sheet: drawn.sheet, ...a });
  const split = await splitTurnaround(ctx, { sheet: drawn.sheet, cut: o.cut, ...(o.noun ? { noun: o.noun } : {}) });
  if (!split.ok) {
    const problems = [`the sheet must have three separate views in one row (${split.reason})`];
    seen({ problems, passed: false });
    return { ok: false, problems };
  }
  const agree = await viewsAgree({ views: split.views, frontKept: split.frontKept });
  if (!agree.ok) {
    seen({ views: split.views, scores: agree.scores, problems: agree.problems, passed: false });
    return { ok: false, problems: agree.problems };
  }
  // the vision look runs only on a sheet that code accepted
  const check = await checkTurnaround(ctx, { photo: o.photo, sheet: drawn.sheet, what: o.what, ...(o.locks ? { locks: o.locks } : {}) });
  seen({ views: split.views, scores: agree.scores, problems: check.problems, passed: check.ok });
  if (!check.ok) return { ok: false, problems: check.problems };
  // the real cut-out is the front; the drawn front only lined the views up
  return { ok: true, result: { views: { front: o.cut, side: split.views.side, back: split.views.back }, sheet: drawn.sheet, ...(agree.depthShare !== undefined ? { depthShare: agree.depthShare } : {}) } };
}

async function make(ctx: ToolCtx, o: TurnaroundInput): Promise<TurnaroundResult> {
  const supplied = await suppliedBack(ctx, { photo: o.photo, others: o.others ?? [], noun: o.noun ?? 'product' });
  if (supplied) {
    o.log('turnaround: a supplied back photo is used; nothing is drawn');
    return { views: { front: o.cut, back: supplied } };
  }
  const first = await attempt(ctx, { ...o, n: 1 });
  if (first.ok) return first.result;
  o.log(`turnaround: redrawing once (${first.problems.join('; ')})`);
  const second = await attempt(ctx, { ...o, n: 2, extra: first.problems });
  if (second.ok) return second.result;
  throw new Error(second.problems.join('; '));
}

export interface TurnaroundInput {
  photo: Buffer;
  cut: Buffer;
  what: string;
  /** the product's noun, for cutting out a supplied back photo */
  noun?: string;
  locks?: string[];
  /** the film's other product photos: a back photo among them wins over a drawn one */
  others?: Buffer[];
  log: (line: string) => void;
  /** told about every drawing, pass or fail (the live script saves them) */
  onAttempt?: (a: TurnaroundAttempt) => void;
}

/**
 * The checked views and the measured depth, or undefined with a log line. Off (TURNAROUND not set) it returns at once and calls nothing. It never throws:
 * every failure ends with today's single-photo body.
 */
export async function turnaroundFor(ctx: ToolCtx, o: TurnaroundInput): Promise<TurnaroundResult | undefined> {
  if (!loadEnv().TURNAROUND) return undefined;
  const key = createHash('sha1').update(o.photo).digest('hex');
  let pending = done.get(key);
  if (!pending) {
    pending = make(ctx, o);
    done.set(key, pending);
    pending.catch(() => done.delete(key));
  }
  try {
    return await pending;
  } catch (err) {
    o.log(`turnaround: ${(err instanceof Error ? err.message : String(err)).replace(/^turnaround: /, '')}, using the single-photo body`);
    return undefined;
  }
}
