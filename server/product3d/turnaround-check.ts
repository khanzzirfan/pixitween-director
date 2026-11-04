// Muse looks at the drawn sheet beside the photo: is the side and back the same physical product, is anything invented.
import type { Buffer } from 'node:buffer';
import sharp from 'sharp';
import type { ToolCtx } from '@shared/tools';

/** The look took 52-56 s on full-size pictures (4 Nov); this is enough to judge a cap, a cage or a mark. */
const LOOK_SIDE = 1024;

/** A JPEG no wider or taller than LOOK_SIDE; a picture sharp cannot read is sent as it is. */
const forLook = (png: Buffer): Promise<Buffer> =>
  sharp(png).resize(LOOK_SIDE, LOOK_SIDE, { fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 85 }).toBuffer().catch(() => png);

export interface TurnaroundCheck {
  ok: boolean;
  problems: string[];
}

export function turnaroundCheckPrompt(o: { what: string; locks?: string[] }): string {
  return [
    `The first picture is the real photo of ${o.what}. The second is a sheet of that product drawn from it: the front, the right side and the back.`,
    'Is the product in the side and the back the same physical product as in the photo (shape, cap, metalwork, glass, label art, colours)? Is anything invented (a lump, a new mark, new words)? Does the side read as the depth of the real product?',
    ...(o.locks?.length ? [`These must hold in every view: ${o.locks.map((l) => `"${l}"`).join('; ')}.`] : []),
    'Name only real problems, each as one short sentence that says what to redraw.',
    'Reply as JSON: {"ok":true|false,"problems":["..."]} with at most 4 problems.',
  ].join('\n');
}

/** Reads Muse's reply (bare, in a code fence, or with text around it). The check never blocks a film: an unreadable reply counts as ok. */
export function parseTurnaroundCheck(raw: unknown): TurnaroundCheck {
  const ok: TurnaroundCheck = { ok: true, problems: [] };
  let v: unknown = raw;
  if (typeof raw === 'string') {
    const found = raw.match(/\{[\s\S]*\}/);
    if (!found) return ok;
    try {
      v = JSON.parse(found[0]);
    } catch {
      return ok;
    }
  }
  if (v === null || typeof v !== 'object') return ok;
  const o = v as { ok?: unknown; problems?: unknown };
  const problems = Array.isArray(o.problems) ? o.problems.filter((p): p is string => typeof p === 'string' && p.trim().length > 0).map((p) => p.trim().slice(0, 300)).slice(0, 4) : [];
  return { ok: o.ok === false ? false : problems.length === 0, problems };
}

/** One Muse look at the photo and the sheet, both made small: one ledger line of 0.005 USD. */
export async function checkTurnaround(ctx: ToolCtx, o: { photo: Buffer; sheet: Buffer; what: string; locks?: string[] }): Promise<TurnaroundCheck> {
  const reply = await ctx.meta.spark.reviewImages(await Promise.all([forLook(o.photo), forLook(o.sheet)]), turnaroundCheckPrompt({ what: o.what, ...(o.locks ? { locks: o.locks } : {}) }));
  ctx.ledger.add(ctx.filmId, 'muse-spark-1.3-contributor', 'turnaround check', 0.005);
  return parseTurnaroundCheck(reply);
}
