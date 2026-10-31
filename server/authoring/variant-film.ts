import { formatPrice } from '@shared/catalog';
import { ASPECT_SIZES } from '@shared/composition';
import { newFilmComposition, registerAsset } from './composition';
import { addLayer, type AddLayerOptions } from './layers';
import { readDirector, writeDirector } from './meta';
import type { ClipAsset, Rect } from './retail-clip';
import { shade } from './retail-clip';
import { addScene } from './scenes';
import { setKeyframes } from './transform';
import type { Aspect, Comp, Obj } from './types';

// The catalog variant film (docs/direction/corpus/06-reference-films.md, R4): one act per variant in the same grammar, so the
// viewer reads the rhythm, then a lineup end card. Built from what the reference ads do with layers alone:
//   act   = the variant's colour field (whips in from the right, R5) + a breathing halo (R3) + the pack tumbling in tilted and
//           settling upright (R1) + the name typed in word by word (R6) + a push that punches into the label (R2) as the cut;
//   end   = every variant in a row on a brand-colour floor band, dropping in one after another, the tagline word by word,
//           each price under its pack, and a long hold (12-37 % of the runtime in the references).
// Pure and deterministic.

export interface Variant {
  product: ClipAsset;
  /** Short variant name: "Vanilla", "Sage Green". */
  name: string;
  /** The act's colour; the field is this colour and the halo a lighter tint of it. */
  color: string;
  price: number;
  currency?: string;
}

export interface VariantFilmInput {
  aspect: Aspect;
  brand: string;
  /** End-card line, typed in word by word; the last word is set in bold. */
  tagline: string;
  /** Brand colour: the end card's floor band. */
  accent: string;
  variants: Variant[];
  /** Seconds per variant act (the references run 1.0 to 2.3 s). */
  actSec?: number;
  /** End card seconds; at least 30 % of the whole film. */
  endSec?: number;
  /** Registered audio asset for a music bed under the whole film. */
  music?: { id: string; src: string; level?: number };
}

const r = (n: number) => Math.round(n * 100) / 100;
/** Layer rotation for the player, which reads radians (see retail-clip.ts `deg`). */
const deg = (d: number) => r(((d * Math.PI) / 180) * 1e4) / 1e4;

/** Mixes a hex colour toward white by f (0..1). */
export function tint(hex: string, f: number): string {
  const n = parseInt(hex.replace('#', '').padEnd(6, '0').slice(0, 6), 16);
  const ch = (v: number) => Math.round(v + (255 - v) * f).toString(16).padStart(2, '0');
  return `#${ch((n >> 16) & 255)}${ch((n >> 8) & 255)}${ch(n & 255)}`;
}

/** Dark text on light colours, white on dark ones (relative luminance). */
export function inkOn(hex: string): string {
  const n = parseInt(hex.replace('#', '').padEnd(6, '0').slice(0, 6), 16);
  const lin = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return L > 0.45 ? '#1a1a1a' : '#ffffff';
}

type Added = { c: Comp; id: string };
const layersOf = (c: Comp, sceneId: string): Obj[] => (c.precomps as Record<string, Obj>)[sceneId]!.layers as Obj[];

function add(c: Comp, sceneId: string, o: Omit<AddLayerOptions, 'sceneId'>, retag = false): Added {
  const before = new Set(layersOf(c, sceneId).map((l) => l.id));
  let out = addLayer(c, { sceneId, ...o });
  const id = layersOf(out, sceneId).find((l) => !before.has(l.id))!.id;
  if (retag) {
    const meta = readDirector(out);
    meta.layers[id] = { ...meta.layers[id]!, role: 'subject', z: o.z ?? 0 };
    out = writeDirector(out, meta);
  }
  return { c: out, id };
}

function patch(c: Comp, sceneId: string, id: string, fn: (l: Obj) => void): Comp {
  const out = structuredClone(c);
  fn(layersOf(out, sceneId).find((x) => x.id === id)!);
  return out;
}

function shape(c: Comp, sceneId: string, box: Rect, fill: string, z: number, path?: Obj, look?: (l: Obj) => void): Added {
  const s = add(c, sceneId, { role: 'bg', kind: 'shape', fill, box, z }, true);
  return { c: patch(s.c, sceneId, s.id, (l) => { if (path) l.path = path; look?.(l); }), id: s.id };
}

/**
 * Words laid out on one line, centred on cx, each its own text layer so they can arrive one after another. Returns the ids in
 * reading order. Widths are estimated (about 0.56 em per character, 0.6 when bold), the same estimate the retail clip uses.
 */
function words(c: Comp, sceneId: string, text: string, o: { cx: number; cy: number; maxW: number; size: number; color: string; boldLast?: boolean; z: number }): { c: Comp; ids: string[] } {
  const ws = text.split(/\s+/).filter(Boolean);
  const em = (w: string, bold: boolean) => w.length * (bold ? 0.6 : 0.56);
  const total = (s: number) => ws.reduce((a, w, n) => a + em(w, !!o.boldLast && n === ws.length - 1) * s, 0) + (ws.length - 1) * 0.3 * s;
  const size = Math.max(12, Math.min(o.size, Math.floor((o.size * o.maxW) / Math.max(1, total(o.size)))));
  let x = o.cx - total(size) / 2;
  const ids: string[] = [];
  ws.forEach((w, n) => {
    const bold = !!o.boldLast && n === ws.length - 1;
    const width = em(w, bold) * size;
    const t = add(c, sceneId, { role: 'caption', kind: 'text', text: w, z: o.z, style: { size, weight: bold ? 800 : 500, color: o.color, align: 'center' }, box: { x, y: o.cy - size * 0.6, w: width, h: size * 1.2 } });
    c = t.c;
    ids.push(t.id);
    x += width + 0.3 * size;
  });
  return { c, ids };
}

/** Staggered arrival for words: each rises 14 px and fades in, 0.12 s apart; with `outAt`, all fade out together from then. */
function typeIn(c: Comp, ids: string[], at: number, cy: number, outAt?: number): Comp {
  ids.forEach((id, n) => {
    const t = at + n * 0.12;
    const fade: Array<[number, number]> = [[0, 0], [r(t), 0], [r(t + 0.25), 1]];
    if (outAt !== undefined && outAt > t + 0.25) fade.push([r(outAt), 1], [r(outAt + 0.2), 0]);
    c = setKeyframes(c, id, 'opacity', fade, 'easeOut');
    c = setKeyframes(c, id, 'y', [[0, r(cy + 14)], [r(t), r(cy + 14)], [r(t + 0.3), r(cy)]], 'easeOut');
  });
  return c;
}

/**
 * One film: an act per variant, then the lineup. Throws when there are no variants; at most 6 acts fit a 30 s film.
 */
export function buildVariantFilm(i: VariantFilmInput): Comp {
  if (!i.variants.length) throw new Error('a variant film needs at least one variant');
  const vs = i.variants.slice(0, 6);
  const { width: W, height: H } = ASPECT_SIZES[i.aspect];
  const u = Math.min(W, H);
  const portrait = H > W;
  const A = Math.max(1.6, i.actSec ?? 2.2);
  const E = Math.max(i.endSec ?? 3.4, (vs.length * A * 0.3) / 0.7);
  let c = newFilmComposition({ aspect: i.aspect, title: `${i.brand}: ${vs.map((v) => v.name).join(', ')}`, palette: [i.accent, ...vs.map((v) => v.color)] });
  for (const v of vs) if (!c.assets[v.product.id]) c = registerAsset(c, { id: v.product.id, kind: 'image', src: v.product.src, width: v.product.width, height: v.product.height });

  vs.forEach((v, n) => {
    const sid = `v${n + 1}`;
    c = addScene(c, { id: sid, durationSec: A, mode: 'motion', intent: `${v.name}: colour field, tumble in, push to the label` });
    // the colour field; after the first act it whips in from the right in 4 frames (the player has no directional blur,
    // and on a flat field the speed alone reads as the whip)
    const field = shape(c, sid, { x: 0, y: 0, w: W, h: H }, v.color, 11);
    c = field.c;
    if (n > 0) c = setKeyframes(c, field.id, 'x', [[0, r(W * 1.5)], [0.13, r(W / 2)]], 'easeOut');
    // a soft lighter halo behind the pack that breathes
    const pk = Math.min((W * (portrait ? 0.5 : 0.36)) / v.product.width, (H * (portrait ? 0.46 : 0.62)) / v.product.height);
    const pw = v.product.width * pk;
    const ph = v.product.height * pk;
    const pcx = W / 2;
    const pcy = H * (portrait ? 0.56 : 0.54);
    const hd = Math.max(pw, ph) * 1.25;
    const halo = shape(c, sid, { x: pcx - hd / 2, y: pcy - hd / 2, w: hd, h: hd }, tint(v.color, 0.7), 10, { kind: 'ellipse', size: [hd, hd] }, (l) => {
      l.effects = [{ name: 'gaussian-blur', params: { blurriness: r(hd * 0.08) } }];
    });
    c = setKeyframes(halo.c, halo.id, 'opacity', [[0, 0], [0.3, 0.95], [r(A * 0.6), 0.7], [A, 0.95]], 'easeInOut');
    c = setKeyframes(c, halo.id, 'scale', [[0, 0.6], [0.4, 1], [A, 1.06]], 'easeOut');
    // the pack: tumbles in tilted from small (R1), settles, pushes, then punches into the label as the cut (R2)
    const pack = add(c, sid, { role: 'product', kind: 'image', assetId: v.product.id, box: { x: pcx - pw / 2, y: pcy - ph / 2, w: pw, h: ph } });
    c = patch(pack.c, sid, pack.id, (l) => { l.effects = [{ name: 'drop-shadow', params: { distance: 24, direction: 180, softness: 34, opacity: 0.35, color: '#000000' } }]; });
    const side = n % 2 === 0 ? -1 : 1; // alternate the tilt so consecutive acts mirror each other
    const punchAt = r(A - 0.55);
    const s = (v2: number) => r(v2 * pk * 1e4) / 1e4;
    c = setKeyframes(c, pack.id, 'scale', [[0, 0], [0.42, s(1.08)], [0.6, s(1)], [punchAt, s(1.1)], [r(A - 0.2), s(2.5)], [A, s(2.6)]], 'easeOut');
    c = setKeyframes(c, pack.id, 'rotation', [[0, deg(side * 22)], [0.42, deg(-side * 4)], [0.62, 0]], 'easeOut');
    c = setKeyframes(c, pack.id, 'opacity', [[0, 0], [0.12, 1]], 'easeOut');
    // the label sits a little above the middle of most packs: keep it centred as the punch scales the pack
    c = setKeyframes(c, pack.id, 'y', [[0, r(pcy)], [punchAt, r(pcy)], [A, r(pcy + ph * 0.06 * 2.6)]], 'easeIn');
    // the variant's name, word by word, upper third
    const ink = inkOn(v.color);
    const nameCy = H * (portrait ? 0.17 : 0.14);
    const nm = words(c, sid, v.name, { cx: W / 2, cy: nameCy, maxW: W * 0.84, size: Math.round(u * 0.12), color: ink, boldLast: true, z: 0.2 });
    // the name clears as the pack punches into the label
    c = typeIn(nm.c, nm.ids, 0.3, nameCy, punchAt);
  });

  // the lineup end card
  const eid = 'end';
  c = addScene(c, { id: eid, durationSec: r(E), mode: 'motion', intent: 'Lineup of every variant with the tagline and prices, held' });
  const floorY = H * (portrait ? 0.7 : 0.72);
  c = shape(c, eid, { x: 0, y: 0, w: W, h: floorY }, tint(i.accent, 0.82), 11).c;
  const floor = shape(c, eid, { x: 0, y: floorY, w: W, h: H - floorY }, i.accent, 10.9);
  c = setKeyframes(floor.c, floor.id, 'y', [[0, r(H + (H - floorY) / 2)], [0.35, r(floorY + (H - floorY) / 2)]], 'easeOut');
  const slot = (W * 0.9) / vs.length;
  vs.forEach((v, n) => {
    const k = Math.min((slot * 0.8) / v.product.width, (H * (portrait ? 0.34 : 0.48)) / v.product.height);
    const pw = v.product.width * k;
    const ph = v.product.height * k;
    const cx = W * 0.05 + slot * (n + 0.5);
    const top = floorY + u * 0.01 - ph;
    const sh = shape(c, eid, { x: cx - pw * 0.48, y: floorY - pw * 0.06, w: pw * 0.96, h: pw * 0.14 }, '#000000', 1.5, { kind: 'ellipse', size: [pw * 0.96, pw * 0.14] }, (l) => {
      l.transform.opacity = 0.35;
      l.effects = [{ name: 'gaussian-blur', params: { blurriness: r(Math.max(6, pw * 0.05)) } }];
    });
    c = sh.c;
    const p = add(c, eid, { role: 'product', kind: 'image', assetId: v.product.id, box: { x: cx - pw / 2, y: top, w: pw, h: ph } });
    c = p.c;
    // each drops in from above one after another and lands with a small bounce, then the row pushes in slowly
    const t0 = 0.25 + n * 0.1;
    const yc = top + ph / 2;
    c = setKeyframes(c, p.id, 'y', [[0, r(yc - H * 0.5)], [r(t0), r(yc - H * 0.5)], [r(t0 + 0.32), r(yc + u * 0.008)], [r(t0 + 0.45), r(yc)]], 'easeIn');
    c = setKeyframes(c, p.id, 'opacity', [[0, 0], [r(t0), 0], [r(t0 + 0.08), 1]], 'easeOut');
    c = setKeyframes(c, p.id, 'scale', [[0, r(k * 1e4) / 1e4], [r(t0 + 0.45), r(k * 1e4) / 1e4], [r(E), r(k * 1.05 * 1e4) / 1e4]], 'linear');
    c = setKeyframes(c, sh.id, 'opacity', [[0, 0], [r(t0 + 0.3), 0], [r(t0 + 0.45), 0.35]], 'easeOut');
    // the price under each pack, on the band
    const priceSize = Math.round(Math.min(u * 0.05, (slot * 0.85) / (formatPrice(v.price, v.currency).length * 0.62)));
    const py = floorY + (H - floorY) * 0.3;
    const pr = add(c, eid, { role: 'caption', kind: 'text', text: formatPrice(v.price, v.currency), z: 0.2, style: { size: priceSize, weight: 800, color: inkOn(i.accent), align: 'center' }, box: { x: cx - slot / 2, y: py - priceSize * 0.6, w: slot, h: priceSize * 1.2 } });
    c = setKeyframes(pr.c, pr.id, 'opacity', [[0, 0], [r(t0 + 0.5), 0], [r(t0 + 0.75), 1]], 'easeOut');
    c = setKeyframes(c, pr.id, 'scale', [[0, 0.6], [r(t0 + 0.5), 0.6], [r(t0 + 0.75), 1.1], [r(t0 + 0.9), 1]], 'easeOut');
  });
  const tagCy = H * (portrait ? 0.2 : 0.16);
  const tg = words(c, eid, i.tagline, { cx: W / 2, cy: tagCy, maxW: W * 0.86, size: Math.round(u * 0.085), color: inkOn(tint(i.accent, 0.82)), boldLast: true, z: 0.2 });
  c = typeIn(tg.c, tg.ids, 0.6 + vs.length * 0.1, tagCy);
  const bm = add(c, eid, { role: 'caption', kind: 'text', text: i.brand, z: 0.2, style: { size: Math.round(u * 0.04), weight: 700, color: shade(i.accent, 0.1), align: 'center' }, box: { x: W * 0.1, y: tagCy + u * 0.09, w: W * 0.8, h: u * 0.05 } });
  c = setKeyframes(bm.c, bm.id, 'opacity', [[0, 0], [r(0.9 + vs.length * 0.1 + tg.ids.length * 0.12), 0], [r(1.2 + vs.length * 0.1 + tg.ids.length * 0.12), 1]], 'easeOut');

  if (i.music) {
    c = registerAsset(c, { id: i.music.id, kind: 'audio', src: i.music.src });
    c = structuredClone(c);
    (c.layers as Obj[]).unshift({
      kind: 'audio', id: 'variant:music', name: 'music', inPoint: 0, outPoint: c.durationInFrames, assetId: i.music.id, level: i.music.level ?? 0.7,
      transform: { position: [0, 0], anchor: [0, 0], scale: [1, 1], rotation: 0, opacity: 1 },
    });
  }
  return c;
}
