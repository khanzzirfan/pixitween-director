// The turnaround: the real front cut-out stands in the left panel of a white sheet and Muse's image model draws the right side and the
// back beside it. THE RULE: the front the viewer sees is always the real photo; a drawn front only lines the views up (docs/architecture/turnaround-3d.md).
import { Buffer } from 'node:buffer';
import sharp from 'sharp';
import type { ToolCtx } from '@shared/tools';
import { backdropColor, columnPieces, whiteKeyAlpha } from '../art/cutout-sheet';
import { keepEnclosed } from '../art/cutout';
import { alphaCutout } from '../media/image';
import { charge } from '../art/events';
import { extractBrandTerms, lintPrompt } from '../art/lint';
import { PRICE } from '../art/prices';
import { trimPng } from './codec';

export const TURNAROUND_SIZE = { width: 1536, height: 1024 } as const;
export const PANELS = 3;
const PANEL_W = TURNAROUND_SIZE.width / PANELS;

/** The cut-out views, trimmed transparent PNGs. `side` is absent when the back is a supplied photo (nothing drawn). */
export interface TurnaroundViews {
  front: Buffer;
  side?: Buffer;
  back: Buffer;
}

/**
 * The real cut-out in the left third of a white canvas: fitted inside 88 % of the third's width and 90 % of the height, centred across the
 * third, standing on a floor line at 95 % of the height. `panel` is the left third as drawn.
 */
export async function referenceCanvas(cut: Buffer): Promise<{ png: Buffer; panel: Buffer }> {
  const { width: W, height: H } = TURNAROUND_SIZE;
  const fitted = await sharp(await trimPng(cut)).resize(Math.round(PANEL_W * 0.88), Math.round(H * 0.9), { fit: 'inside' }).png().toBuffer();
  const m = await sharp(fitted).metadata();
  const left = Math.round((PANEL_W - m.width!) / 2);
  const top = Math.round(H * 0.95 - m.height!);
  const png = await sharp({ create: { width: W, height: H, channels: 3, background: '#ffffff' } }).composite([{ input: fitted, left, top }]).png().toBuffer();
  const panel = await sharp(png).extract({ left: 0, top: 0, width: PANEL_W, height: H }).png().toBuffer();
  return { png, panel };
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** What the image model is told. Brand and person names are taken out of `what` (the same lint the invented photo uses). */
export function turnaroundPrompt(o: { what: string }): string {
  let what = o.what.replace(/\s+/g, ' ').trim().slice(0, 200);
  const terms = [...extractBrandTerms(what), ...lintPrompt(what, { subject: true }).violations.map((v) => v.term)];
  for (const term of terms) if (term) what = what.replace(new RegExp(escapeRegExp(term), 'gi'), '').replace(/\s+/g, ' ').trim();
  return [
    `A product turnaround sheet of ${what || 'a product'}: three panels in one row, each a third of the width.`,
    'The first panel already shows the real product from the front. That panel is kept exactly as it is, pixel for pixel: same position, size, colours and every detail.',
    'Draw the SAME physical product in the other two panels, at the same size, the same height and standing on the same floor line as the first panel:',
    'panel 2 its right side (turned 90 degrees), panel 3 its back (turned 180 degrees).',
    'The second reference picture is the real photo of the product, for its details.',
    'Same shape, same materials, same colours, same cap and metalwork. The back shows what the back of this real product carries (the far side of the decoration, the glass seen from behind, any small print as plain marks), never a new brand name or new words.',
    // the yoghurt's berry art was drawn again on the back and on both edges of the side (4 Nov), and the check refused both drawings
    'Do not repeat the front picture: the label art, the illustration and the name on the front stay on the front. A label or sleeve that wraps round the product keeps its colour all the way round: the side shows it continuing, with the art only at the front edge where it wraps, and the back shows the same sleeve plain, in the same colour.',
    'Orthographic product views at eye level, even soft shadowless studio light that matches the first panel, pure white background, clear white space between the panels, no floor shadow, no captions, no extra objects.',
  ].join('\n');
}

/** One image call: the side and the back drawn beside the real front. `extra` are the problems of the last drawing, sent back as words. */
export async function drawTurnaround(
  ctx: ToolCtx,
  o: { cut: Buffer; photo: Buffer; what: string; extra?: string[] },
): Promise<{ sheet: Buffer; reference: { png: Buffer; panel: Buffer } }> {
  const reference = await referenceCanvas(o.cut);
  const prompt = [turnaroundPrompt({ what: o.what }), ...(o.extra?.length ? ['Fix these problems of the last drawing:', ...o.extra] : [])].join('\n');
  let sheet: Buffer;
  try {
    sheet = await ctx.meta.image.edit(prompt, [reference.png, o.photo], `${TURNAROUND_SIZE.width}x${TURNAROUND_SIZE.height}`);
  } catch (err) {
    throw new Error(`turnaround: ${err instanceof Error ? err.message : String(err)}`);
  }
  charge(ctx, 'muse-image-1.0', 'turnaround', PRICE.turnaroundUsd);
  return { sheet, reference };
}

const KEPT_SIZE = { width: 48, height: 128 } as const;

/**
 * How far the drawn front is from the real cut-out, 0 identical to 1 nothing alike, three decimals. Both are trimmed and laid in the same small box, so the
 * backdrop's tint and a shift of a few pixels do not count: a pixel opaque in both scores its colour difference, a pixel opaque in only one scores 1.
 */
export async function frontDifference(cut: Buffer, front: Buffer): Promise<number> {
  const [a, b] = await Promise.all([cut, front].map(async (p) => sharp(await trimPng(p)).resize(KEPT_SIZE.width, KEPT_SIZE.height, { fit: 'fill' }).ensureAlpha().raw().toBuffer()));
  let sum = 0;
  let n = 0;
  for (let i = 0; i < a!.length; i += 4) {
    const inA = a![i + 3]! > 127;
    const inB = b![i + 3]! > 127;
    if (!inA && !inB) continue;
    n++;
    sum += inA && inB ? (Math.abs(a![i]! - b![i]!) + Math.abs(a![i + 1]! - b![i + 1]!) + Math.abs(a![i + 2]! - b![i + 2]!)) / 765 : 1;
  }
  return n ? Math.round((sum / n) * 1000) / 1000 : 1;
}

/** SAM objects smaller than this share of the sheet are specks; below this confidence, guesses. */
const SPECK = 0.002;
const MIN_CONFIDENCE = 0.35;

/** One transparent, trimmed view per third of the sheet, from a full-size alpha mask; undefined when a third is empty. */
async function viewsFromAlpha(source: Buffer, alpha: Uint8Array): Promise<Buffer[] | undefined> {
  const { width: W, height: H } = TURNAROUND_SIZE;
  const rgba = await alphaCutout(source, Buffer.from(alpha), { feather: 0.8 });
  const views: Buffer[] = [];
  for (let t = 0; t < PANELS; t++) {
    const left = Math.round(t * PANEL_W);
    const view = await trimPng(await sharp(rgba).extract({ left, top: 0, width: Math.round(PANEL_W), height: H }).png().toBuffer());
    const m = await sharp(view).metadata();
    // an empty third trims to nothing (or to itself, untouched)
    if (!m.width || !m.height || (m.width >= PANEL_W - 1 && m.height >= H - 1) || m.width * m.height < W * H * SPECK) return undefined;
    views.push(view);
  }
  return views;
}

/**
 * The views by SAM: every object it finds for `noun` joins the third of the sheet its centre is in (SAM often gives a cup and its sleeve as two objects).
 * One SAM call. Undefined when a third has nothing.
 */
async function samViews(ctx: ToolCtx, source: Buffer, noun: string): Promise<Buffer[] | undefined> {
  const { width: W, height: H } = TURNAROUND_SIZE;
  const objects = await ctx.meta.sam.segmentImage(source, noun);
  charge(ctx, 'sam-3.1', '1 image', PRICE.samImageUsd);
  const alpha = new Uint8Array(W * H);
  const filled = new Set<number>();
  for (const o of objects) {
    if ((o.confidence ?? 1) < MIN_CONFIDENCE || o.alpha.length !== W * H) continue;
    const b = o.bounds;
    if ((b.right - b.left) * (b.bottom - b.top) < W * H * SPECK) continue;
    filled.add(Math.min(PANELS - 1, Math.floor((b.left + b.right) / 2 / PANEL_W)));
    for (let i = 0; i < alpha.length; i++) if (o.alpha[i]! > alpha[i]!) alpha[i] = o.alpha[i]!;
  }
  return filled.size === PANELS ? viewsFromAlpha(source, alpha) : undefined;
}

/** The views by keying the white backdrop, keeping whatever the product's drawn outline encloses (a white rim, a white cap). No model call. */
async function keyedViews(source: Buffer): Promise<Buffer[] | undefined> {
  const { width: W, height: H } = TURNAROUND_SIZE;
  const rgb = await sharp(source).removeAlpha().raw().toBuffer();
  const alpha = keepEnclosed(whiteKeyAlpha(rgb, W, H, backdropColor(rgb, W, H)), W, H);
  if (columnPieces(alpha, W, H, PANELS).length !== PANELS) return undefined;
  return viewsFromAlpha(source, alpha);
}

/**
 * The sheet cut into front, side and back (one per third, left to right), and how far the drawn front is from the real cut-out (frontDifference). The
 * views are cut by SAM asking for `noun`, which keeps a white product's white parts; when SAM does not fill all three thirds, the sheet is keyed against
 * its white backdrop instead.
 */
export async function splitTurnaround(
  ctx: ToolCtx,
  o: { sheet: Buffer; cut: Buffer; noun?: string },
): Promise<{ ok: true; views: TurnaroundViews & { side: Buffer }; frontKept: number; by: 'sam' | 'key' } | { ok: false; reason: string }> {
  const { width: W, height: H } = TURNAROUND_SIZE;
  const source = await sharp(o.sheet).resize(W, H, { fit: 'fill' }).removeAlpha().png().toBuffer();
  // SAM answers to some words and not others: "cup" found all three cups of a sheet that "yoghurt cup" found none in (4 Nov), so the last word of the noun
  // and a general "container" are tried in turn, each one call, until a try fills all three thirds
  let bySam: Buffer[] | undefined;
  const last = o.noun?.trim().split(/\s+/).at(-1);
  for (const noun of [...new Set([o.noun?.trim(), last, 'container'].filter((n): n is string => !!n))]) {
    bySam = await samViews(ctx, source, noun).catch(() => undefined);
    if (bySam) break;
  }
  const views = bySam ?? (await keyedViews(source).catch(() => undefined));
  if (!views) return { ok: false, reason: `found fewer than ${PANELS} views` };
  const [front, side, back] = views;
  return { ok: true, views: { front: front!, side: side!, back: back! }, frontKept: await frontDifference(o.cut, front!), by: bySam ? 'sam' : 'key' };
}
