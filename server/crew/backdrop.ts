// A scene's backdrop picture always covers the whole frame. Plates come in smaller than the canvas (720 x 1280 on 1080 x 1920), so a
// backdrop that a builder or a fix pass left at scale 1 shows as a small rectangle with bare bars round it. This pass scales the
// backdrop up to cover the frame at every moment, keeping the zoom the crew drew (1 -> 1.18 becomes 1.5 -> 1.77): only the size is
// raised, never the motion.
import { readDirector } from '../authoring/meta';
import type { Comp, Obj } from '../authoring/types';

type Key<T> = { t: number; v: T };
type Anim<T> = T | Array<Key<T>>;

const isKeys = <T>(a: Anim<T>): a is Array<Key<T>> => Array.isArray(a) && a.length > 0 && typeof a[0] === 'object' && a[0] !== null && 't' in (a[0] as object);
const values = <T>(a: Anim<T>): T[] => (isKeys(a) ? a.map((k) => k.v) : [a]);

/** A hair over cover, so no seam of a pixel shows at the edges. */
const OVERSCAN = 1.01;

/** The smallest scale at which an image of `img` drawn with `anchor` at `pos` covers a `W` x `H` frame, turned by `deg`. */
export function coverScale(img: { w: number; h: number }, anchor: [number, number], pos: [number, number], W: number, H: number, deg = 0): number {
  const [ax, ay] = anchor;
  const [px, py] = pos;
  const need = Math.max(px / Math.max(ax, 1e-6), (W - px) / Math.max(img.w - ax, 1e-6), py / Math.max(ay, 1e-6), (H - py) / Math.max(img.h - ay, 1e-6));
  // a turned picture needs a little more to keep its corners out of the frame
  const turn = 1 + Math.abs(Math.sin((deg * Math.PI) / 180)) * (Math.max(W, H) / Math.min(W, H));
  return need * turn * OVERSCAN;
}

/** Scales every image backdrop of a scene up until it covers the frame throughout; returns the layers it changed. */
export function fillBackdrops(comp: Comp, sceneId: string): { comp: Comp; fixed: string[] } {
  const pre = (comp.precomps as Record<string, Obj> | undefined)?.[sceneId];
  if (!pre) return { comp, fixed: [] };
  const W = Number(pre.width ?? comp.width);
  const H = Number(pre.height ?? comp.height);
  const meta = readDirector(comp).layers;
  const assets = { ...((comp.assets ?? {}) as Record<string, Obj>), ...((pre.assets ?? {}) as Record<string, Obj>) };
  const fixed: string[] = [];
  let out: Comp | undefined;
  for (const [i, l] of ((pre.layers ?? []) as Obj[]).entries()) {
    const role = meta[l.id]?.role ?? (String(l.id).endsWith(':bg') ? 'bg' : undefined);
    if (role !== 'bg' || l.kind !== 'image') continue;
    const a = assets[l.assetId as string];
    if (!a?.width || !a?.height) continue;
    const t = (l.transform ?? {}) as Obj;
    const img = { w: Number(a.width), h: Number(a.height) };
    const anchor = (Array.isArray(t.anchor) && typeof t.anchor[0] === 'number' ? t.anchor : [img.w / 2, img.h / 2]) as [number, number];
    const positions = values<[number, number]>((t.position ?? [W / 2, H / 2]) as Anim<[number, number]>);
    const turns = values<number>((t.rotation ?? 0) as Anim<number>).map(Number);
    const maxTurn = Math.max(0, ...turns.map(Math.abs));
    const need = Math.max(...positions.map((p) => coverScale(img, anchor, p, W, H, maxTurn)));
    const scale = (t.scale ?? [1, 1]) as Anim<[number, number]>;
    const least = Math.min(...values(scale).flatMap((v) => (Array.isArray(v) ? v.map(Number) : [Number(v)])));
    if (!(least > 0) || least >= need) continue;
    const by = need / least;
    const grow = (v: [number, number]): [number, number] => [round(v[0] * by), round(v[1] * by)];
    const next = isKeys(scale) ? scale.map((k) => ({ ...k, v: grow(k.v) })) : grow(scale);
    out ??= structuredClone(comp);
    const target = ((out.precomps as Record<string, Obj>)[sceneId]!.layers as Obj[])[i]!;
    target.transform = { ...(target.transform as Obj), scale: next };
    fixed.push(String(l.id));
  }
  return { comp: out ?? comp, fixed };
}

const round = (n: number) => Math.round(n * 10000) / 10000;
