// Owned by S7a. Flatten a scene's bg, subject and product layers into one picture (frame 0, static boxes).
// Limitation: rotation and parent chains are ignored.
import sharp from 'sharp';
import type { FilmState } from '@shared/composition';
import type { ToolCtx } from '@shared/tools';
import { flatten, imageSize } from '../media/image';

type Comp = NonNullable<FilmState['composition']>;
type Vec2 = [number, number];
type Kf<T> = { t: number; v: T };
type Field<T> = T | Kf<T>[];

const isKf = <T>(f: Field<T>): f is Kf<T>[] => Array.isArray(f) && f.length > 0 && typeof f[0] === 'object' && f[0] !== null && !Array.isArray(f[0]);

function at(field: Field<Vec2>, frame: number): Vec2 {
  if (!isKf(field)) return field;
  if (frame <= field[0]!.t) return field[0]!.v;
  const last = field[field.length - 1]!;
  if (frame >= last.t) return last.v;
  let i = 0;
  while (field[i + 1]!.t <= frame) i++;
  const a = field[i]!;
  const b = field[i + 1]!;
  const p = (frame - a.t) / (b.t - a.t);
  return [a.v[0] + (b.v[0] - a.v[0]) * p, a.v[1] + (b.v[1] - a.v[1]) * p];
}

export function staticBox(
  layer: { transform: { position: Field<Vec2>; anchor: Field<Vec2>; scale: Field<Vec2> } },
  assetSize: { width: number; height: number },
  _compSize: { width: number; height: number },
  frame = 0,
): { left: number; top: number; width: number; height: number } {
  const [x, y] = at(layer.transform.position, frame);
  const [ax, ay] = at(layer.transform.anchor, frame);
  const [sx, sy] = at(layer.transform.scale, frame);
  return { left: x - ax * sx, top: y - ay * sy, width: assetSize.width * sx, height: assetSize.height * sy };
}

const FLAT_ROLES = ['bg', 'subject', 'product'];

/** `frame` is a frame of the scene; the layers are placed where they are at that moment (default: the first frame). */
export async function flattenScene(ctx: Pick<ToolCtx, 'assets'>, comp: Comp, sceneId: string, size: { width: number; height: number }, frame = 0): Promise<Buffer> {
  const precomp = (comp.precomps as Record<string, { layers: Array<Record<string, any>> }> | undefined)?.[sceneId];
  const roles = (comp.meta as { director?: { layers?: Record<string, { role: string }> } } | undefined)?.director?.layers ?? {};
  const draw: Array<{ png: Buffer; left: number; top: number }> = [];

  for (const layer of precomp?.layers ?? []) {
    if (layer.kind !== 'image' || layer.hidden || !layer.assetId) continue;
    if (roles[layer.id] && !FLAT_ROLES.includes(roles[layer.id]!.role)) continue;
    const bytes = await ctx.assets.read(layer.assetId);
    const natural = await imageSize(bytes);
    const box = staticBox(layer as never, natural, size, frame);
    const w = Math.max(1, Math.round(box.width));
    const h = Math.max(1, Math.round(box.height));
    let left = Math.round(box.left);
    let top = Math.round(box.top);
    let img = sharp(bytes).resize(w, h, { fit: 'fill' });
    // clip to the canvas: sharp composites only inside it
    const cl = Math.max(0, -left);
    const ct = Math.max(0, -top);
    const cw = Math.min(w - cl, size.width - Math.max(left, 0));
    const ch = Math.min(h - ct, size.height - Math.max(top, 0));
    if (cw <= 0 || ch <= 0) continue;
    if (cl || ct || cw !== w || ch !== h) {
      img = sharp(await img.png().toBuffer()).extract({ left: cl, top: ct, width: cw, height: ch });
      left = Math.max(left, 0);
      top = Math.max(top, 0);
    }
    draw.push({ png: await img.png().toBuffer(), left, top });
  }
  return flatten(draw, size);
}
