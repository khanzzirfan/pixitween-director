import type { Buffer } from 'node:buffer';
import sharp from 'sharp';
import type { Comp, Obj } from '../../authoring/types';
import { sceneLayers, titleBoxes, type TitleBox } from './json-rules';

// The 3D words as the film sheet sees them: which frames catch words on their way out (letters leaving one by one, which Muse took for a crop on
// 4 Nov), and how well the words stand out from the set behind them, measured on the drawn frames.

/**
 * The least contrast (WCAG ratio of the words' colour to the median colour round them) the words may have. On 4 Nov the white end card on a
 * blush set measured 1.59 and its #fceaef tagline 1.38, both hard to read; white hook words on a deeper pink measured 2.02 and read.
 */
export const WORD_CONTRAST_MIN = 1.8;
/** How far round the words' box the set is read, as a share of the box's height. */
const RING = 0.35;

const boxesOf = (film: Comp): TitleBox[] => {
  const f = film as Obj;
  return titleBoxes(sceneLayers(film), { W: f.width as number, H: f.height as number, fps: f.fps as number });
};

/** Whether any line of words is on its way out at `t` seconds. */
export function leavingAt(film: Comp, t: number): boolean {
  return boxesOf(film).some((b) => t >= b.leaves && t < b.to);
}

/** When a line of words has fully come in: its entrance starts at its first frame and takes its own seconds plus a step for every letter. */
const inAt = (b: TitleBox, fps: number): number => {
  const enter = b.l.source?.enter as { atFrame?: number; seconds?: number; each?: number } | undefined;
  return enter ? (enter.atFrame ?? 0) / fps + (enter.seconds ?? 0) + (enter.each ?? 0) * b.text.length : b.from;
};

const luminance = (rgb: number[]): number => {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(rgb[0]!) + 0.7152 * lin(rgb[1]!) + 0.0722 * lin(rgb[2]!);
};

/** The WCAG contrast ratio of two colours, 1 (the same) to 21 (black on white). */
export function contrast(a: number[], b: number[]): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
}

const hex = (s: string): number[] | undefined => (/^#[0-9a-f]{6}$/i.test(s) ? [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16)) : undefined);

/**
 * When each line of words is fully in and not yet leaving, for the lines no frame in `times` already shows so: a frame to draw only to measure them
 * (the sheet's own in frames catch the words still rising and its out frames catch them leaving). Seconds, ascending.
 */
export function wordTimes(film: Comp, times: number[]): number[] {
  const fps = (film as Obj).fps as number;
  const out = new Set<number>();
  for (const b of boxesOf(film)) {
    const from = inAt(b, fps);
    if (times.some((t) => t >= from && t < b.leaves)) continue;
    const t = Math.round((from + 0.05) * 100) / 100;
    if (t < b.leaves) out.add(t);
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * The median colour of the frame in a ring round the box (the set behind the words, or their plate), and how far the box's own pixels stand out from
 * it: the contrast of the boldest 5% of them, which are the letters once they are drawn (their bevel and light, not their flat colour).
 */
async function ringColour(frame: Buffer, b: TitleBox, film: Obj): Promise<{ behind: number[]; drawn: number } | undefined> {
  const { data, info } = await sharp(frame).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const sx = info.width / (film.width as number);
  const sy = info.height / (film.height as number);
  const pad = b.h * RING;
  const [l, r, t, d] = [b.left - pad, b.right + pad, b.top - pad, b.bottom + pad].map((v, i) => Math.round(v * (i < 2 ? sx : sy)));
  const ch: number[][] = [[], [], []];
  const box: number[][] = [];
  for (let y = Math.max(0, t!); y < Math.min(info.height, d!); y++)
    for (let x = Math.max(0, l!); x < Math.min(info.width, r!); x++) {
      const inside = x >= b.left * sx && x < b.right * sx && y >= b.top * sy && y < b.bottom * sy;
      const i = (y * info.width + x) * info.channels;
      if (inside) {
        box.push([data[i]!, data[i + 1]!, data[i + 2]!]);
        continue;
      }
      for (let c = 0; c < 3; c++) ch[c]!.push(data[i + c]!);
    }
  if (!ch[0]!.length) return undefined;
  const behind = ch.map((v) => v.sort((p, q) => p - q)[v.length >> 1]!);
  const bold = box.map((p) => contrast(p, behind)).sort((p, q) => p - q);
  return { behind, drawn: bold.length ? bold[Math.floor(bold.length * 0.95)]! : 1 };
}

/**
 * Words that barely show against what is behind them, measured on the drawn frames at `times` (seconds): each line of words is read on a frame where it
 * has fully come in and not begun to leave (`wordTimes` asks for such a frame), and named once, in words for Muse.
 */
export async function wordContrast(frames: Buffer[], times: number[], film: Comp): Promise<string[]> {
  const f = film as Obj;
  const fps = f.fps as number;
  const problems: string[] = [];
  for (const b of boxesOf(film)) {
    const colour = hex(String(b.l.material?.color ?? '#ffffff'));
    const at = times.findIndex((t) => t >= inAt(b, fps) && t < b.leaves);
    if (!colour || at < 0) continue;
    const seen = await ringColour(frames[at]!, b, f).catch(() => undefined);
    if (!seen) continue;
    // the flat colour against the set, or the letters as drawn (gold with its bevel reads far better than its flat colour says): the better of the two
    const ratio = Math.max(contrast(colour, seen.behind), seen.drawn);
    if (ratio < WORD_CONTRAST_MIN)
      problems.push(`the words "${b.text}" barely show at ${times[at]!.toFixed(1)} s (contrast ${ratio.toFixed(1)}:1 against the set behind them): put a plate behind them (endCard.plate), set the letters in gold or chrome, or give the set a deeper colour there`);
  }
  return problems;
}
