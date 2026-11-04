// Code checks on the three drawn views, before any model look: a drawing of another shape or colour is redrawn without a vision call,
// and the side gives the product's true depth.
import type { Buffer } from 'node:buffer';
import sharp from 'sharp';
import { deltaE, rgbToLab, type Lab } from './colour';
import type { TurnaroundViews } from './turnaround';

/** frontDifference of the drawn front against the real cut-out, on the product's own pixels only; a guess until a live run has measured kept fronts */
const MAX_FRONT_DIFFERENCE = 0.12;
const MIN_OUTLINE_OVERLAP = 0.85;
const MAX_COLOUR_DISTANCE = 25;
const DEPTH_SHARE = { min: 0.15, max: 1.25 } as const;
const MAX_CLEAR = 0.6;
const OPAQUE = 127;
const SCALE_H = 128;

interface Mask {
  width: number;
  height: number;
  /** 1 where opaque */
  data: Uint8Array;
  /** how much of the view's own box is clear */
  clear: number;
  /** mean Lab of the opaque pixels */
  lab: Lab;
  /** the view's own size in pixels */
  w: number;
  h: number;
}

/** A view at SCALE_H rows high: its opaque mask, how clear its box is, its mean colour. */
async function maskOf(png: Buffer): Promise<Mask> {
  const meta = await sharp(png).metadata();
  const w = meta.width ?? 1;
  const h = meta.height ?? 1;
  const width = Math.max(1, Math.round((w / h) * SCALE_H));
  const { data } = await sharp(png).ensureAlpha().resize(width, SCALE_H, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
  const mask = new Uint8Array(width * SCALE_H);
  let n = 0;
  let [l, a, b] = [0, 0, 0];
  for (let i = 0; i < mask.length; i++) {
    if (data[i * 4 + 3]! > OPAQUE) {
      mask[i] = 1;
      n++;
      const lab = rgbToLab([data[i * 4]!, data[i * 4 + 1]!, data[i * 4 + 2]!]);
      l += lab[0];
      a += lab[1];
      b += lab[2];
    }
  }
  return { width, height: SCALE_H, data: mask, clear: 1 - n / mask.length, lab: n ? [l / n, a / n, b / n] : [0, 0, 0], w, h };
}

/** Intersection over union of two masks of the same height, centred on each other, the second flipped left to right. */
function flippedOverlap(front: Mask, back: Mask): number {
  const width = Math.max(front.width, back.width);
  const at = (m: Mask, x: number, y: number, flip: boolean) => {
    const off = Math.floor((width - m.width) / 2);
    const mx = (flip ? m.width - 1 - (x - off) : x - off);
    return mx >= 0 && mx < m.width ? m.data[y * m.width + mx]! : 0;
  };
  let inter = 0;
  let union = 0;
  for (let y = 0; y < SCALE_H; y++)
    for (let x = 0; x < width; x++) {
      const f = at(front, x, y, false);
      const k = at(back, x, y, true);
      inter += f & k;
      union += f | k;
    }
  return union ? inter / union : 0;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Do the views agree? `frontKept` is how far the model left the front it was given (0 identical). `depthShare` is the product's depth as a share of its
 * width, read from the side view against the front. Without a side (a supplied back photo) the rules that need it are skipped.
 */
export interface AgreeScores {
  frontKept: number;
  /** the back's outline flipped over the front's, intersection over union */
  outline: number;
  /** Lab distance between the back's and the front's mean colours */
  colour: number;
  depthShare?: number;
}

export async function viewsAgree(o: { views: TurnaroundViews; frontKept: number }): Promise<{ ok: boolean; problems: string[]; depthShare?: number; scores: AgreeScores }> {
  const problems: string[] = [];
  const front = await maskOf(o.views.front);
  const back = await maskOf(o.views.back);
  const side = o.views.side ? await maskOf(o.views.side) : undefined;

  if (o.frontKept > MAX_FRONT_DIFFERENCE) problems.push('the front panel was redrawn: it must stay exactly as given');
  const outline = round2(flippedOverlap(front, back));
  const colour = Math.round(deltaE(front.lab, back.lab));
  if (outline < MIN_OUTLINE_OVERLAP) problems.push('the back is another shape than the front: it must be the same outline seen from behind');
  if (colour > MAX_COLOUR_DISTANCE) problems.push('the back is another colour than the front: keep the same materials and colours');

  let depthShare: number | undefined;
  if (side) {
    depthShare = round2(side.w / side.h / (front.w / front.h));
    if (depthShare < DEPTH_SHARE.min || depthShare > DEPTH_SHARE.max) problems.push(`the side view is the wrong width (${depthShare} of the front's): draw it as the same product turned 90 degrees`);
  }
  for (const [name, m] of [['front', front], ['side', side], ['back', back]] as const) if (m && m.clear > MAX_CLEAR) problems.push(`the ${name} view is mostly empty`);
  const scores: AgreeScores = { frontKept: o.frontKept, outline, colour, ...(depthShare !== undefined ? { depthShare } : {}) };
  return { ok: problems.length === 0, problems, ...(depthShare !== undefined ? { depthShare } : {}), scores };
}
