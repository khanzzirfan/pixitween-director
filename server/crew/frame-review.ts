import { Buffer } from 'node:buffer';
import sharp from 'sharp';
import type { ToolCtx } from '@shared/tools';
import { planBoard, reviewBoard, totalSeconds, type CinematicBoard } from '../authoring/beatsheet';

// Muse looks at its own film. The film is built from the board, a few key frames are drawn, Muse is shown them in order and says what looks wrong
// (the product lost in a crop, a colour that fights, a grade too heavy, text on a busy spot); if it names problems the board goes back to it once to be
// revised, and the film is built again. The creative choices stay with Muse: this file only draws the frames, asks, and keeps the elements and the
// set (their pictures are already made) while the shots, light, grade and finish may change. Any failure keeps the board it started with.
// The review is also the gate on the whole cinematic cut: the revised film is looked at once more, and a film Muse still names problems with, or
// whose frames are measurably burnt out, is not shipped (the finished 2D film stands instead).

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

/** How bright the frames are: the mean brightness (0 to 1) over all of them, and the share of pixels that are near white. */
export interface Exposure {
  mean: number;
  hot: number;
}

/** Past this the picture is burnt out whatever Muse says: the mean brightness over the frames, or the share of near-white pixels. */
export const BURNT = { mean: 0.86, hot: 0.6 } as const;

/** Measures the frames' brightness, on a small copy of each. */
export async function measureExposure(frames: Buffer[]): Promise<Exposure> {
  let sum = 0;
  let hot = 0;
  let n = 0;
  for (const f of frames) {
    // a frame that cannot be read as a picture adds nothing to the measure
    const data = await sharp(f).resize(54, 96, { fit: 'fill' }).removeAlpha().raw().toBuffer().catch(() => Buffer.alloc(0));
    for (let i = 0; i + 2 < data.length; i += 3) {
      const l = (0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!) / 255;
      sum += l;
      if (l > 0.85) hot++;
      n++;
    }
  }
  return n ? { mean: Math.round((sum / n) * 100) / 100, hot: Math.round((hot / n) * 100) / 100 } : { mean: 0, hot: 0 };
}

export const isBurnt = (e: Exposure): boolean => e.mean >= BURNT.mean || e.hot >= BURNT.hot;

export interface Critique {
  /** Muse is happy with the frames. */
  fine: boolean;
  problems: string[];
}

/** What Muse is asked when it looks at the frames. It sees them in order, with the shots they come from. */
export function critiquePrompt(board: CinematicBoard, times: number[], seen: { photo?: boolean; exposure?: Exposure; final?: boolean } = {}): string {
  const shots = board.sheet.beats.map((b, i) => `${i + 1}. ${b.seconds}s ${b.size} ${b.move}${b.cut && b.cut !== 'hard' ? `, cut ${b.cut}` : ''}${b.text ? `, words "${b.text}"` : ''}`);
  return [
    seen.photo ? 'The first picture is the real photo of the product. The pictures after it are frames of the film.' : '',
    `You wrote the board for a product film: "${board.concept}" (${board.mood}). These are ${times.length} frames of the film as it was drawn, in order, at ${times.map((t) => `${t}s`).join(', ')}.`,
    'The shots: ' + shots.join('; ') + '.',
    ...(seen.exposure ? [`Measured on the frames: the average brightness is ${seen.exposure.mean} (0 black, 1 white) and ${Math.round(seen.exposure.hot * 100)}% of the picture is near white; above 0.8 the colours usually wash out and the product loses its edges.`] : []),
    ...(seen.photo ? ['Does the product in the frames still look like the product in the photo (its shape, thickness, colours and pattern), or has it turned into something else?'] : []),
    ...(seen.final ? ['This is the film after one revision, and the only other choice is a plain, clear flat film made from the same photo. Say it is fine only if this is a better advertisement than that would be: the product must be recognisable, well lit and the hero in every frame.'] : []),
    'Look at them as the director. Is the product always clear and the hero? Is anything cropped badly, lost in the dark or burnt out, hidden behind words or a piece of the set? Do the colours, light and grade work together and fit the idea? Does the last frame read as an end card?',
    'Name only real problems that a change to the shots, the camera, the light, the grade or the finish would fix, each as one short sentence that says what to change (for example "shot 3 crops the label: pull the camera back", "the grade is too heavy, the product turns muddy"). If the frames work, say so.',
    'Reply as JSON: {"fine":true|false,"problems":["..."]} with at most 4 problems.',
  ].filter(Boolean).join('\n');
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

/** What the last look at the frames decided: whether the film may ship, and why not. */
export interface Judgement {
  ship: boolean;
  problems: string[];
  exposure: Exposure;
}

/** Looks at drawn frames once: Muse's critique (with the photo and the measured brightness), and the measured floor for a burnt picture. */
export async function judgeFrames(ctx: ToolCtx, o: { board: CinematicBoard; times: number[]; frames: Buffer[]; photo?: Buffer; final?: boolean }): Promise<Judgement & { critique: Critique }> {
  const exposure = await measureExposure(o.frames);
  const images = o.photo ? [o.photo, ...o.frames] : o.frames;
  const critique = parseCritique(await ctx.meta.spark.reviewImages(images, critiquePrompt(o.board, o.times, { ...(o.photo ? { photo: true } : {}), exposure, ...(o.final ? { final: true } : {}) })));
  ctx.ledger.add(ctx.filmId, 'muse-spark-1.3-contributor', 'frame review', 0.006);
  const burnt = isBurnt(exposure);
  const problems = burnt ? [`the frames are burnt out (average brightness ${exposure.mean}, ${Math.round(exposure.hot * 100)}% near white)`, ...critique.problems].slice(0, 4) : critique.problems;
  return { ship: critique.fine && !burnt, problems, exposure, critique };
}

export interface ReviewResult {
  board: CinematicBoard;
  /** The look at the frames as first drawn, when it could be made; absent when the review could not run. */
  judged?: Judgement;
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
    const first = await judgeFrames(ctx, { board: o.board, times, frames, ...(o.photo ? { photo: o.photo } : {}) });
    const judged: Judgement = { ship: first.ship, problems: first.problems, exposure: first.exposure };
    keep.judged = judged;
    if (first.ship) {
      log('Muse looked at the frames and kept the board');
      return keep;
    }
    log(`Muse saw: ${first.problems.join('; ')}`);
    const asks = [...first.problems.map((p) => `seen in the film's own frames: ${p}`), 'keep the elements and the set exactly as they are; change only the shots, camera, light, grade and finish'];
    const planned = await planBoard(ctx, { title: o.title, ...(o.brief ? { brief: o.brief } : {}), ...(o.photo ? { photo: o.photo } : {}), seconds: Math.min(10, Math.max(4, totalSeconds(o.board.sheet))), flat: o.flat, prior: { board: o.board, violations: asks } });
    if (planned.source !== 'muse') return { ...keep, problems: first.problems };
    const merged = reviewBoard({ ...planned.board, elements: o.board.elements, ...(o.board.set ? { set: o.board.set } : {}) });
    if (merged.hard.length) return { ...keep, problems: first.problems };
    log(`Muse revised the board after looking: ${merged.board.concept}`);
    return { board: merged.board, revised: true, problems: first.problems, ...(keep.judged ? { judged: keep.judged } : {}) };
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
