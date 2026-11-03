import type { Buffer } from 'node:buffer';
import type { ToolCtx } from '@shared/tools';
import { planBoard, reviewBoard, totalSeconds, type CinematicBoard } from '../authoring/beatsheet';

// Muse looks at its own film. The film is built from the board, a few key frames are drawn, Muse is shown them in order and says what looks wrong
// (the product lost in a crop, a colour that fights, a grade too heavy, text on a busy spot); if it names problems the board goes back to it once to be
// revised, and the film is built again. The creative choices stay with Muse: this file only draws the frames, asks, and keeps the elements and the
// set (their pictures are already made) while the shots, light, grade and finish may change. Any failure keeps the board it started with.

/** How many frames Muse is shown. */
export const REVIEW_FRAMES = 6;

/**
 * The moments to look at: the middle of up to REVIEW_FRAMES - 1 shots, spread over the film so the first, the last and the ones between are all seen,
 * and the end of the last shot (the end card). Seconds, ascending.
 */
export function keyTimes(board: CinematicBoard, count = REVIEW_FRAMES): number[] {
  const beats = board.sheet.beats;
  const mids: number[] = [];
  let clock = 0;
  for (const b of beats) {
    mids.push(Math.round((clock + b.seconds / 2) * 100) / 100);
    clock += b.seconds;
  }
  const want = Math.min(count - 1, mids.length);
  const picked = Array.from({ length: want }, (_, k) => mids[want === 1 ? 0 : Math.round((k * (mids.length - 1)) / (want - 1))]!);
  const end = Math.max(0, Math.round((totalSeconds(board.sheet) - 0.1) * 100) / 100);
  return [...new Set([...picked, end])].sort((a, b) => a - b);
}

export interface Critique {
  /** Muse is happy with the frames. */
  fine: boolean;
  problems: string[];
}

/** What Muse is asked when it looks at the frames. It sees them in order, with the shots they come from. */
export function critiquePrompt(board: CinematicBoard, times: number[]): string {
  const shots = board.sheet.beats.map((b, i) => `${i + 1}. ${b.seconds}s ${b.size} ${b.move}${b.cut && b.cut !== 'hard' ? `, cut ${b.cut}` : ''}${b.text ? `, words "${b.text}"` : ''}`);
  return [
    `You wrote the board for a product film: "${board.concept}" (${board.mood}). These are ${times.length} frames of the film as it was drawn, in order, at ${times.map((t) => `${t}s`).join(', ')}.`,
    'The shots: ' + shots.join('; ') + '.',
    'Look at them as the director. Is the product always clear and the hero? Is anything cropped badly, lost in the dark or burnt out, hidden behind words or a piece of the set? Do the colours, light and grade work together and fit the idea? Does the last frame read as an end card?',
    'Name only real problems that a change to the shots, the camera, the light, the grade or the finish would fix, each as one short sentence that says what to change (for example "shot 3 crops the label: pull the camera back", "the grade is too heavy, the product turns muddy"). If the frames work, say so.',
    'Reply as JSON: {"fine":true|false,"problems":["..."]} with at most 4 problems.',
  ].join('\n');
}

/** Reads Muse's reply: a flag and a short list of sentences. An unreadable reply counts as fine, so the film is left alone. */
export function parseCritique(raw: unknown): Critique {
  let v: unknown = raw;
  if (typeof raw === 'string') {
    try {
      v = JSON.parse(raw);
    } catch {
      return { fine: true, problems: [] };
    }
  }
  const o = v as { fine?: unknown; problems?: unknown } | null;
  const problems = Array.isArray(o?.problems) ? o.problems.filter((p): p is string => typeof p === 'string' && p.trim().length > 0).map((p) => p.trim().slice(0, 200)).slice(0, 4) : [];
  return { fine: o?.fine === true || problems.length === 0, problems };
}

export interface ReviewResult {
  board: CinematicBoard;
  /** Muse revised the board after looking. */
  revised: boolean;
  problems: string[];
}

export interface ReviewInput {
  board: CinematicBoard;
  title: string;
  brief?: string;
  photo?: Buffer;
  flat: boolean;
  /** Draws the film as it is now at these seconds, one picture each (JPEG or PNG). */
  render: (times: number[]) => Promise<Buffer[]>;
  log?: (line: string) => void;
}

/**
 * Shows Muse the frames and, if it names problems, asks it once for a revised board. The revised board keeps the elements and the set the film
 * was made with. Returns the board the film should be built from.
 */
export async function reviewFrames(ctx: ToolCtx, o: ReviewInput): Promise<ReviewResult> {
  const log = o.log ?? (() => {});
  const keep: ReviewResult = { board: o.board, revised: false, problems: [] };
  try {
    const times = keyTimes(o.board);
    const frames = await o.render(times);
    if (!frames.length) return keep;
    const critique = parseCritique(await ctx.meta.spark.reviewImages(frames, critiquePrompt(o.board, times)));
    ctx.ledger.add(ctx.filmId, 'muse-spark-1.3-contributor', 'frame review', 0.006);
    if (critique.fine) {
      log('Muse looked at the frames and kept the board');
      return keep;
    }
    log(`Muse saw: ${critique.problems.join('; ')}`);
    const asks = [...critique.problems.map((p) => `seen in the film's own frames: ${p}`), 'keep the elements and the set exactly as they are; change only the shots, camera, light, grade and finish'];
    const planned = await planBoard(ctx, { title: o.title, ...(o.brief ? { brief: o.brief } : {}), ...(o.photo ? { photo: o.photo } : {}), seconds: Math.min(10, Math.max(4, totalSeconds(o.board.sheet))), flat: o.flat, prior: { board: o.board, violations: asks } });
    if (planned.source !== 'muse') return { ...keep, problems: critique.problems };
    const merged = reviewBoard({ ...planned.board, elements: o.board.elements, ...(o.board.set ? { set: o.board.set } : {}) });
    if (merged.hard.length) return { ...keep, problems: critique.problems };
    log(`Muse revised the board after looking: ${merged.board.concept}`);
    return { board: merged.board, revised: true, problems: critique.problems };
  } catch (err) {
    log(`frame review skipped: ${err instanceof Error ? err.message : String(err)}`);
    return keep;
  }
}

const STAGE_WAIT_MS = 30_000;
const READY_WAIT_SEC = 20;
/** The whole review (drawing the frames included) gives up after this long and the film goes out as built. */
export const REVIEW_TIMEOUT_MS = 120_000;

/** Whether the review should run: on unless FRAME_REVIEW=0, and never in tests, where nothing is serving the stage page. */
export const reviewEnabled = (): boolean => process.env.FRAME_REVIEW !== '0' && process.env.NODE_ENV !== 'test';

/** Draws the composition at `times` (seconds) in headless Chromium on the app's own stage page, at half size, as JPEGs. The web server must be reachable at `base`. */
export async function renderKeyFrames(composition: unknown, times: number[], base = process.env.EXPORT_RENDER_BASE ?? `http://localhost:${process.env.DIRECTOR_WEB_PORT ?? 5173}`): Promise<Buffer[]> {
  const pw = await import('playwright');
  const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const timer = setTimeout(() => void browser.close().catch(() => undefined), REVIEW_TIMEOUT_MS);
  try {
    const page = await (await browser.newContext({ viewport: { width: 700, height: 1300 } })).newPage();
    await page.route('**/__review-film.json', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(composition) }));
    await page.goto(`${base}/stage-check.html?film=live&file=${encodeURIComponent('/__review-film.json')}`);
    await page.waitForFunction(() => Boolean((window as unknown as { __stage?: unknown }).__stage), undefined, { timeout: STAGE_WAIT_MS });
    await page.waitForTimeout(3000);
    type Stage = { seek(s: number): Promise<void>; whenReady(s: number): Promise<boolean> };
    const ready = await page.evaluate((s) => (window as unknown as { __stage: Stage }).__stage.whenReady(s), READY_WAIT_SEC);
    if (!ready) throw new Error('the 3D product did not finish drawing');
    const out: Buffer[] = [];
    for (const t of times) {
      await page.evaluate((s) => (window as unknown as { __stage: Stage }).__stage.seek(s), t);
      await page.waitForTimeout(900);
      out.push(await page.locator('canvas').first().screenshot({ type: 'jpeg', quality: 72 }));
    }
    return out;
  } finally {
    clearTimeout(timer);
    await browser.close().catch(() => undefined);
  }
}
