import { ASPECT_SIZES } from '@shared/composition';
import { LENGTH_SLACK } from '../../authoring/beatsheet';
import { PRODUCT_H } from '../../authoring/cinematic-film';
import { TITLE_PROPS_MAX, titleSpace, wordsBox, type TitleFace } from '../../authoring/titles3d';
import { lightValidate } from '../../engine/light-validator';
import type { Aspect, Comp, Obj } from '../../authoring/types';

// Code rules on a built film's JSON, checked before anything is drawn. The title box helpers are shared with scripts/titles-harness.ts.

/** The most of the frame (a share of each side) a title may come near the edge. */
export const EDGE_MARGIN = 0.03;
/** The share of the product's screen box a title may cover at the middle of a shot. */
export const COVER_MAX = 0.35;

/** A line of 3D words as it sits on the screen, in pixels, and when it is there (seconds). */
export interface TitleBox {
  l: Obj;
  text: string;
  cx: number;
  cy: number;
  w: number;
  h: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  from: number;
  to: number;
  /** when it starts to leave */
  leaves: number;
}

const faceOf = (font: string): TitleFace => (font.includes('optimer') ? 'soft' : font.includes('gentilis') ? 'serif' : 'sans');

/** The scene's layers: the inner composition of a built film, or the layers of the composition itself. */
export const sceneLayers = (film: Comp): Obj[] => ((film as Obj).precomps?.cine?.layers ?? (film as Obj).layers ?? []) as Obj[];

/** Every line of 3D words (text3d props of the titles world) with its screen box. */
export function titleBoxes(layers: Obj[], o: { W: number; H: number; fps: number }): TitleBox[] {
  const { ppu } = titleSpace(o.W, o.H);
  return layers
    .filter((l) => l.kind === 'prop3d' && l.stage === 'cine:titles' && l.source?.type === 'text3d')
    .map((l) => {
      const box = wordsBox(l.source.text, faceOf(l.source.font), l.source.font.endsWith('bold'), l.source.size * ppu);
      const cx = o.W / 2 + l.position[0] * ppu;
      const cy = o.H / 2 - l.position[1] * ppu;
      const from = l.source.enter.atFrame / o.fps;
      const to = l.outPoint / o.fps;
      const leaves = l.source.exit ? l.source.exit.atFrame / o.fps : to;
      return { l, text: String(l.source.text).replace(/\n/g, ' '), cx, cy, w: box.w, h: box.h, left: cx - box.w / 2, right: cx + box.w / 2, top: cy - box.h / 2, bottom: cy + box.h / 2, from, to, leaves };
    });
}

/** Words past the frame's edge, and two lines on top of each other while both are on screen. */
export function layoutProblems(boxes: TitleBox[], o: { W: number; H: number }): string[] {
  const problems: string[] = [];
  const edge = o.W * EDGE_MARGIN;
  for (const x of boxes) if (x.left < edge || x.right > o.W - edge || x.top < edge || x.bottom > o.H - edge) problems.push(`"${x.l.source.text}" runs past the frame's edge`);
  for (const [n, a] of boxes.entries())
    for (const z of boxes.slice(n + 1)) {
      const together = Math.min(a.to, z.to) - Math.max(a.from, z.from) > 0.1;
      const overlap = Math.min(a.right, z.right) > Math.max(a.left, z.left) && Math.min(a.bottom, z.bottom) > Math.max(a.top, z.top);
      if (together && overlap) problems.push(`"${a.l.source.text}" and "${z.l.source.text}" are on screen at once on top of each other`);
    }
  return problems;
}

type V3 = [number, number, number];
type Keyed<T> = Array<{ t: number; v: T; hold?: boolean }>;
const isKeyed = (v: unknown): v is Keyed<unknown> => Array.isArray(v) && v.length > 0 && typeof v[0] === 'object' && v[0] !== null && 't' in (v[0] as object);

/** The value of an animatable at a frame, straight between its keys (the eases are left out: this is an estimate). */
function at<T extends number | V3>(v: T | Keyed<T>, f: number): T {
  if (!isKeyed(v)) return v as T;
  const ks = v as Keyed<T>;
  if (f <= ks[0]!.t) return ks[0]!.v;
  for (let i = 1; i < ks.length; i++) {
    const a = ks[i - 1]!;
    const b = ks[i]!;
    if (f <= b.t) {
      if (a.hold) return a.v;
      const u = (f - a.t) / Math.max(1e-6, b.t - a.t);
      return (Array.isArray(a.v) ? (a.v as V3).map((x, k) => x + ((b.v as V3)[k]! - x) * u) : (a.v as number) + ((b.v as number) - (a.v as number)) * u) as T;
    }
  }
  return ks.at(-1)!.v;
}

/** The shots of a world as camera keys show them: a shot runs from the frame after one hold key to the next hold key. */
function shotsOf(world: Obj, frames: number): Array<{ start: number; end: number }> {
  const pos = world.camera?.position;
  if (!isKeyed(pos)) return [];
  const ends = pos.filter((k) => k.hold).map((k) => k.t);
  if (!ends.length) return [];
  const out: Array<{ start: number; end: number }> = [];
  let start = 0;
  for (const e of ends) {
    out.push({ start, end: e });
    start = e + 1;
  }
  if (start < frames - 1) out.push({ start, end: frames });
  return out;
}

/** The product's screen box (pixels) in the middle of a shot: centred, as tall as the camera's fill says, as wide as its proportions. */
function productBox(world: Obj, product: Obj, shot: { start: number; end: number }, o: { W: number; H: number }): { left: number; right: number; top: number; bottom: number } | undefined {
  const mid = (shot.start + shot.end) / 2;
  const pos = at<V3>(world.camera.position, mid);
  const target = at<V3>(world.camera.target, mid);
  const fov = at<number>(world.camera.fov ?? 35, mid);
  const d = Math.hypot(pos[0] - target[0], pos[1] - target[1], pos[2] - target[2]);
  const size = typeof product.size === 'number' ? product.size : PRODUCT_H;
  const fill = size / (2 * d * Math.tan((fov * Math.PI) / 360));
  const ratio = (() => {
    const p = product.source?.proportions;
    if (p) return p.height / p.width;
    const c = product.source?.contour as Array<[number, number]> | undefined;
    if (!c?.length) return 1;
    const xs = c.map((q) => q[0]);
    const ys = c.map((q) => q[1]);
    return (Math.max(...ys) - Math.min(...ys)) / Math.max(1, Math.max(...xs) - Math.min(...xs));
  })();
  const h = Math.min(o.H, fill * o.H);
  const w = Math.min(o.W, h / Math.max(0.2, ratio));
  return { left: o.W / 2 - w / 2, right: o.W / 2 + w / 2, top: o.H / 2 - h / 2, bottom: o.H / 2 + h / 2 };
}

/**
 * Problems in the film's JSON, in words for Muse; empty when it passes. The length, the prop limits, every line of words inside the frame
 * and clear of the others, and no line covering the product at the middle of a shot.
 */
export function jsonRules(film: Comp, o: { askedSeconds: number; aspect: Aspect }): string[] {
  const problems: string[] = [];
  const valid = lightValidate(film);
  if (!valid.ok) problems.push(`the film does not validate: ${valid.issues[0]!.path} ${valid.issues[0]!.message}`);
  const fps = (film as Obj).fps as number;
  const seconds = Math.round(((film as Obj).durationInFrames / fps) * 100) / 100;
  if (Math.abs(seconds - o.askedSeconds) > LENGTH_SLACK) problems.push(`the film runs ${seconds} s but ${o.askedSeconds} s were asked: ${seconds > o.askedSeconds ? 'shorten' : 'lengthen'} the shots`);

  const layers = sceneLayers(film);
  const perWorld = new Map<string, number>();
  for (const l of layers) if (l.kind === 'prop3d' && typeof l.stage === 'string') perWorld.set(l.stage, (perWorld.get(l.stage) ?? 0) + 1);
  for (const [stage, n] of perWorld) if (n > TITLE_PROPS_MAX) problems.push(`the world ${stage} holds ${n} props, over the limit of ${TITLE_PROPS_MAX}`);

  const { width: W, height: H } = ASPECT_SIZES[o.aspect];
  const boxes = titleBoxes(layers, { W, H, fps });
  problems.push(...layoutProblems(boxes, { W, H }));

  const world = layers.find((l) => l.id === 'cine:world');
  const product = layers.find((l) => l.kind === 'prop3d' && l.role === 'product');
  if (world && product) {
    for (const [n, shot] of shotsOf(world, (film as Obj).durationInFrames).entries()) {
      const p = productBox(world, product, shot, { W, H });
      if (!p) continue;
      const t = (shot.start + shot.end) / 2 / fps;
      const area = (p.right - p.left) * (p.bottom - p.top);
      for (const b of boxes) {
        if (t < b.from || t > b.leaves) continue;
        const cut = Math.max(0, Math.min(p.right, b.right) - Math.max(p.left, b.left)) * Math.max(0, Math.min(p.bottom, b.bottom) - Math.max(p.top, b.top));
        if (area > 0 && cut / area > COVER_MAX) problems.push(`the words "${b.text}" cover ${Math.round((cut / area) * 100)}% of the product in shot ${n + 1}: move them or shorten them`);
      }
    }
  }
  return problems;
}
