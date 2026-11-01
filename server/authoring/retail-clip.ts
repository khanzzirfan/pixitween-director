import { formatPrice } from '@shared/catalog';
import { ASPECT_SIZES } from '@shared/composition';
import { newFilmComposition, registerAsset } from './composition';
import { addLayer, type AddLayerOptions } from './layers';
import { LOOKS, shadowDirection, type Look, type LookId } from './looks';
import { readDirector, writeDirector } from './meta';
import { addScene } from './scenes';
import { setKeyframes } from './transform';
import type { Aspect, Comp, Obj } from './types';

export interface ClipAsset {
  id: string;
  src: string;
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Slot = 'above' | 'right' | 'left' | 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';

export interface RetailClipInput {
  aspect: Aspect;
  /** The themed plate behind the product (one per category or occasion). A look that draws its own world (price promo) ignores it. */
  plate?: ClipAsset;
  /** The product cut-out (transparent background). */
  product: ClipAsset;
  title: string;
  /** A slim second line under the name: size, flavour, pack count. */
  subtitle?: string;
  price: number;
  /** The price before a sale, shown struck through above the price. */
  wasPrice?: number;
  currency?: string;
  /** A short brand mark for the corner badge; no badge when absent. */
  brand?: string;
  /** Price badge ring, brand badge and frame colour. */
  accent?: string;
  /** Draws a brand-colour border around the plate. */
  frame?: boolean;
  /** Where the price badge goes; 'auto' (default) takes the first free slot. */
  badgeSlot?: 'auto' | Slot;
  durationSec?: number;
  /** The look recipe (docs/direction/corpus/02-looks.md); tabletop hero by default. */
  look?: LookId;
  /** Music tempo; the price lands and pulses on its beats. */
  bpm?: number;
}

export interface RetailLayout {
  window: Rect;
  pack: Rect;
  captionZone: Rect;
  badge: { cx: number; cy: number; d: number; slot: Slot | 'none' };
  brand?: Rect;
}

const ID = 'clip';
const r = (n: number) => Math.round(n * 100) / 100;
// rects that only touch do not overlap; the half-pixel tolerance keeps rounding from rejecting a badge placed exactly a gap away
const EPS = 0.5;
const hit = (a: Rect, b: Rect) => a.x < b.x + b.w - EPS && b.x < a.x + a.w - EPS && a.y < b.y + b.h - EPS && b.y < a.y + a.h - EPS;
const grow = (a: Rect, m: number): Rect => ({ x: a.x - m, y: a.y - m, w: a.w + 2 * m, h: a.h + 2 * m });

/**
 * Where everything goes. The pack is large and centred above a slim caption zone; the price badge and the brand mark take
 * whichever slot is free (the first that clears the pack, the caption and each other), so they never cover the product.
 */
export function retailLayout(
  W: number,
  H: number,
  product: { width: number; height: number },
  o: { frame?: boolean; badgeSlot?: 'auto' | Slot; brand?: boolean } = {},
): RetailLayout {
  const m = o.frame ? Math.min(W, H) * 0.035 : 0;
  const win: Rect = { x: m, y: m, w: W - 2 * m, h: H - 2 * m };
  const portrait = H > W;
  const captionZone: Rect = { x: win.x, y: win.y + win.h * 0.84, w: win.w, h: win.h * 0.16 };
  const gap = Math.min(W, H) * 0.03;
  const pad = Math.min(W, H) * 0.04;
  const k = Math.min((win.w * 0.6) / product.width, (win.h * (portrait ? 0.46 : 0.6)) / product.height);
  const pw = product.width * k;
  const ph = product.height * k;
  // the pack stands on a table: its base sits on a line in the lower part of the frame, where the plate's tabletop is
  const baseY = win.y + win.h * (portrait ? 0.7 : 0.76);
  const pack: Rect = { x: win.x + (win.w - pw) / 2, y: Math.max(win.y + pad, baseY - ph), w: pw, h: ph };

  const keepOut = (extra: Rect[]) => [grow(pack, gap), captionZone, ...extra];
  const inside = (b: Rect) => b.x >= win.x + pad * 0.5 && b.y >= win.y + pad * 0.5 && b.x + b.w <= win.x + win.w - pad * 0.5 && b.y + b.h <= win.y + win.h - pad * 0.5;

  const bs = Math.min(W, H) * 0.24;
  const brandRect = (slot: 'top-right' | 'top-left'): Rect => ({ x: slot === 'top-right' ? win.x + win.w - bs - pad : win.x + pad, y: win.y + pad, w: bs, h: bs * 0.9 });

  const placeBadge = (d: number, slot: Slot): Rect => {
    const half = d / 2;
    switch (slot) {
      case 'above': return { x: pack.x + pack.w / 2 - half, y: pack.y - gap - d, w: d, h: d };
      case 'right': return { x: pack.x + pack.w + gap, y: pack.y + d * 0.1, w: d, h: d };
      case 'left': return { x: pack.x - gap - d, y: pack.y + d * 0.1, w: d, h: d };
      case 'top-right': return { x: win.x + win.w - d - pad, y: win.y + pad, w: d, h: d };
      case 'top-left': return { x: win.x + pad, y: win.y + pad, w: d, h: d };
      case 'bottom-right': return { x: win.x + win.w - d - pad, y: captionZone.y - d - gap, w: d, h: d };
      case 'bottom-left': return { x: win.x + pad, y: captionZone.y - d - gap, w: d, h: d };
    }
  };
  const order: Slot[] = o.badgeSlot && o.badgeSlot !== 'auto' ? [o.badgeSlot] : ['right', 'left', 'above', 'top-right', 'top-left', 'bottom-right', 'bottom-left'];
  const brandOptions: Array<'top-right' | 'top-left'> = ['top-right', 'top-left'];

  // the preferred slot wins over a bigger badge, down to a size that still reads; only then does any slot at any size do
  const sizes: number[] = [];
  for (let d = Math.min(W, H) * 0.3; d >= Math.min(W, H) * 0.12; d *= 0.9) sizes.push(d);
  const tries: Array<[number, Slot]> = [
    ...order.flatMap((slot) => sizes.filter((d) => d >= Math.min(W, H) * 0.2).map((d) => [d, slot] as [number, Slot])),
    ...sizes.flatMap((d) => order.map((slot) => [d, slot] as [number, Slot])),
  ];
  for (const [d, slot] of tries) {
    {
      const b = placeBadge(d, slot);
      if (!inside(b) || keepOut([]).some((z) => hit(b, z))) continue;
      // the brand mark takes a corner the badge does not use
      let brand: Rect | undefined;
      if (o.brand) {
        brand = brandOptions.map(brandRect).find((c) => inside(c) && !keepOut([b]).some((z) => hit(c, z)));
        if (!brand) continue;
      }
      return { window: win, pack, captionZone, badge: { cx: b.x + d / 2, cy: b.y + d / 2, d, slot }, ...(brand ? { brand } : {}) };
    }
  }
  const fallback = o.brand ? brandOptions.map(brandRect).find((c) => inside(c) && !hit(c, grow(pack, gap))) : undefined;
  return { window: win, pack, captionZone, badge: { cx: win.x + win.w - pad - bs / 2, cy: win.y + pad + bs / 2, d: 0, slot: 'none' }, ...(fallback ? { brand: fallback } : {}) };
}

/**
 * The price badge's scale keys, on the music's beats: it arrives on beat 2 (a pop with overshoot, or a slam from oversize for a
 * promo), then pulses on every second beat while there is room for one.
 */
export function pulseKeys(durationSec: number, bpm = 120, arrive: 'pop' | 'slam' = 'pop'): Array<[number, number]> {
  const beat = 60 / bpm;
  const land = 2 * beat;
  const keys: Array<[number, number]> =
    arrive === 'slam'
      ? [[0, 0], [r(land - 0.02), 0], [r(land), 1.45], [r(land + 0.25), 1]]
      : [[0, 0], [r(land - 0.3), 0], [r(land), 1.18], [r(land + 0.2), 1]];
  for (let t = land + 2 * beat; t + 0.25 <= durationSec; t += 2 * beat) keys.push([r(t - 0.2), 1], [r(t), 1.1], [r(t + 0.25), 1]);
  return keys;
}

const layersOf = (c: Comp): Obj[] => (c.precomps as Record<string, Obj>)[ID]!.layers as Obj[];

/** Adds a layer and returns its id (addLayer picks the id). */
function add(c: Comp, o: Omit<AddLayerOptions, 'sceneId'>, role?: 'subject'): { c: Comp; id: string } {
  const before = new Set(layersOf(c).map((l) => l.id));
  let out = addLayer(c, { sceneId: ID, ...o });
  const id = layersOf(out).find((l) => !before.has(l.id))!.id;
  if (role) {
    const meta = readDirector(out);
    meta.layers[id] = { ...meta.layers[id]!, role, z: o.z ?? 0 };
    out = writeDirector(out, meta);
  }
  return { c: out, id };
}

function patch(c: Comp, id: string, fn: (l: Obj) => void): Comp {
  const out = structuredClone(c);
  fn(layersOf(out).find((x) => x.id === id)!);
  return out;
}

/** A shape layer of any path in a box, retagged so the role check does not treat it as the plate. */
function shape(c: Comp, box: Rect, fill: string, z: number, path?: Obj, look?: (l: Obj) => void): { c: Comp; id: string } {
  const s = add(c, { role: 'bg', kind: 'shape', fill, box, z }, 'subject');
  return { c: patch(s.c, s.id, (l) => { if (path) l.path = path; look?.(l); }), id: s.id };
}

/** Deterministic noise from the title, so a catalog wall varies per product but every render of one product is identical. */
function rng(seed: string): () => number {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h >>>= 0) % 10000) / 10000;
  };
}

/** Mixes a hex colour toward black by f (0..1). */
export function shade(hex: string, f: number): string {
  const n = parseInt(hex.replace('#', '').padEnd(6, '0').slice(0, 6), 16);
  const ch = (v: number) => Math.round(v * (1 - f)).toString(16).padStart(2, '0');
  return `#${ch((n >> 16) & 255)}${ch((n >> 8) & 255)}${ch(n & 255)}`;
}

const FONT_SERIF = 'Georgia, "Times New Roman", serif';
/** Layer rotation for the player. The AEP schema says degrees, but the player reads a layer's rotation as radians (checked
 * on screen, 31 Oct 2026), so every rotation goes through here: one line to change when the engine is fixed. */
const deg = (d: number) => r((d * Math.PI) / 180 * 1e4) / 1e4;

/**
 * One short retail clip for one product, the template behind a catalog. The look decides the world (a themed plate that drifts,
 * turns or racks focus, or a brand-colour field with rays), how the pack stands in it (a contact shadow on the light's far
 * side, a lifted card, or a gloss-floor reflection), how it arrives, the air in front of it (bokeh, confetti), a highlight
 * that travels across the pack, the grade and the price badge's shape. The price lands and pulses on the beat. Pure and
 * deterministic: nothing here calls a model.
 */
export function buildRetailClip(i: RetailClipInput): Comp {
  const { width: W, height: H } = ASPECT_SIZES[i.aspect];
  const D = Math.max(2.5, i.durationSec ?? 4);
  const look: Look = LOOKS[i.look ?? 'tabletop-hero'];
  const accent = i.accent ?? '#0a7a3d';
  const rand = rng(i.title);
  const L = retailLayout(W, H, i.product, { ...(i.frame !== undefined ? { frame: i.frame } : {}), ...(i.badgeSlot ? { badgeSlot: i.badgeSlot } : {}), brand: !!i.brand });
  const win = L.window;
  const plate = look.plate === null ? undefined : i.plate;
  let c = newFilmComposition({ aspect: i.aspect, title: i.title, palette: [i.frame ? accent : '#f4f1ec'] });
  if (plate) c = registerAsset(c, { id: plate.id, kind: 'image', src: plate.src, width: plate.width, height: plate.height });
  c = registerAsset(c, { id: i.product.id, kind: 'image', src: i.product.src, width: i.product.width, height: i.product.height });
  c = addScene(c, { id: ID, durationSec: D, mode: 'motion', intent: `Retail clip: ${i.title} (${look.id})` });

  if (i.frame) c = shape(c, { x: 0, y: 0, w: W, h: H }, accent, 12).c;

  // the world
  const cx = win.x + win.w / 2;
  if (plate) {
    const p = add(c, { role: 'bg', kind: 'image', assetId: plate.id, box: win, z: 11 });
    c = patch(p.c, p.id, (l) => {
      if (look.plateBlur > 0) l.effects = [{ name: 'gaussian-blur', params: { blurriness: look.plateBlur } }];
      const over = look.world === 'drift' ? 1.04 : look.world === 'rotate' ? 1.07 : 1;
      l.transform.scale = (l.transform.scale as number[]).map((v) => r(v * over * 1e4) / 1e4);
    });
    if (look.world === 'drift') c = setKeyframes(c, p.id, 'x', [[0, r(cx)], [D, r(cx - W * 0.012)]], 'linear');
    if (look.world === 'rotate') c = setKeyframes(c, p.id, 'rotation', [[0, 0], [D, deg(1.5)]], 'linear');
    if (look.world === 'rack-focus') {
      // focus racks from the room to the product: a soft copy of the plate fades up over the sharp one
      const soft = add(c, { role: 'bg', kind: 'image', assetId: plate.id, box: win, z: 10.9 });
      c = patch(soft.c, soft.id, (l) => { l.effects = [{ name: 'gaussian-blur', params: { blurriness: 7 } }]; });
      c = setKeyframes(c, soft.id, 'opacity', [[0, 0], [0.3, 0], [1.1, 1]], 'easeInOut');
    }
  } else {
    // a drawn world: the brand colour with slow light rays behind the product
    // a deeper shade of the brand colour, so the accent badge and brand tile still stand out against it
    c = shape(c, win, shade(accent, 0.45), 11).c;
    const diag = Math.hypot(win.w, win.h);
    const rays = shape(c, { x: cx - diag / 2, y: L.pack.y + L.pack.h / 2 - diag / 2, w: diag, h: diag }, '#ffffff', 10.8, { kind: 'polystar', starType: 'star', points: 14, outerRadius: diag / 2, innerRadius: diag * 0.012 }, (l) => { l.transform.opacity = 0.13; });
    c = setKeyframes(rays.c, rays.id, 'rotation', [[0, 0], [D, deg(10)]], 'linear');
  }

  if (i.frame && L.window.x > 0) {
    // the frame's border is drawn again in front of the world, so a plate that drifts, turns or is overscanned never shows past it
    const m = L.window.x;
    for (const b of [{ x: 0, y: 0, w: W, h: m }, { x: 0, y: H - m, w: W, h: m }, { x: 0, y: 0, w: m, h: H }, { x: W - m, y: 0, w: m, h: H }]) c = shape(c, b, accent, 10.5).c;
  }

  // the pack stands in that world
  const dir = shadowDirection(look.lightSide);
  const lean = look.lightSide === 'left' ? 1 : look.lightSide === 'right' ? -1 : 0;
  let shadowId: string | undefined;
  if (look.shadow !== 'lifted-card') {
    // a soft contact shadow under the base, pushed a little away from the light, so the pack rests on the table
    const sw = L.pack.w * 0.95;
    const sh = Math.max(L.pack.w * 0.12, 10);
    const s = shape(c, { x: L.pack.x + (L.pack.w - sw) / 2 + lean * L.pack.w * 0.06, y: L.pack.y + L.pack.h - sh * 0.55, w: sw, h: sh }, '#000000', 1.5, { kind: 'ellipse', size: [sw, sh] }, (l) => {
      l.transform.opacity = 0.42;
      l.effects = [{ name: 'gaussian-blur', params: { blurriness: Math.max(6, sh * 0.35) } }];
    });
    c = s.c;
    shadowId = s.id;
  }
  const packShadow =
    look.shadow === 'lifted-card'
      ? { distance: 26, direction: 180, softness: 34, opacity: 0.38, color: '#1a1a1a' }
      : { distance: 16, direction: dir, softness: 22, opacity: 0.36, color: '#1a1a1a' };
  const pack = add(c, { role: 'product', kind: 'image', assetId: i.product.id, box: L.pack });
  c = patch(pack.c, pack.id, (l) => { l.effects = [{ name: 'drop-shadow', params: packShadow }]; });
  const packId = pack.id;
  // copies that move with the pack: a reflection on a gloss floor and a soft copy for the focus rack
  const followers: string[] = [];
  let reflectionId: string | undefined;
  if (look.shadow === 'reflection') {
    const refl = add(c, { role: 'subject', kind: 'image', assetId: i.product.id, box: L.pack, z: 1.4 }, 'subject');
    c = patch(refl.c, refl.id, (l) => { l.effects = [{ name: 'gaussian-blur', params: { blurriness: 3 } }]; });
    reflectionId = refl.id;
  }
  let softPackId: string | undefined;
  if (look.world === 'rack-focus') {
    const soft = add(c, { role: 'subject', kind: 'image', assetId: i.product.id, box: L.pack, z: 0.97 }, 'subject');
    c = patch(soft.c, soft.id, (l) => { l.effects = [{ name: 'gaussian-blur', params: { blurriness: 9 } }]; });
    softPackId = soft.id;
    followers.push(soft.id);
  }
  if (look.sweep) {
    // the light moves, not the product: a soft bright band travels across the pack, kept inside its width and height and
    // faded in and out at the edges so it reads as light on the product. (Clipping it to the silhouette would be better,
    // but the player draws track mattes and masks empty inside a scene.)
    const bw = L.pack.w * 0.24;
    const bh = L.pack.h * 0.9;
    const t0 = Math.min(1.1, D - 1.3);
    const band = shape(c, { x: L.pack.x + L.pack.w * 0.12 - bw / 2, y: L.pack.y + (L.pack.h - bh) / 2, w: bw, h: bh }, '#ffffff', 0.9, undefined, (l) => {
      l.blendMode = 'screen';
      l.transform.rotation = deg(8);
      l.effects = [{ name: 'gaussian-blur', params: { blurriness: r(bw * 0.22) } }];
    });
    c = setKeyframes(band.c, band.id, 'x', [[0, r(L.pack.x + L.pack.w * 0.12)], [t0, r(L.pack.x + L.pack.w * 0.12)], [t0 + 1.1, r(L.pack.x + L.pack.w * 0.88)]], 'easeInOut');
    c = setKeyframes(c, band.id, 'opacity', [[0, 0], [t0, 0], [t0 + 0.55, 0.55], [t0 + 1.1, 0]], 'easeInOut');
  }

  // air: the third motion layer
  if (look.air === 'bokeh') {
    const u = Math.min(W, H);
    for (let n = 0; n < 6; n++) {
      const front = n >= 4;
      const d = u * (front ? 0.13 + rand() * 0.06 : 0.05 + rand() * 0.06);
      const x = front ? (n === 4 ? win.x + win.w * (0.02 + rand() * 0.1) : win.x + win.w * (0.88 + rand() * 0.1)) : win.x + win.w * (0.08 + rand() * 0.84);
      const y = win.y + win.h * (front ? 0.15 + rand() * 0.5 : 0.06 + rand() * 0.5);
      const b = shape(c, { x: x - d / 2, y: y - d / 2, w: d, h: d }, front ? '#fff4e0' : '#ffffff', front ? 0.85 : 1.3, { kind: 'ellipse', size: [d, d] }, (l) => {
        l.blendMode = 'screen';
        l.effects = [{ name: 'gaussian-blur', params: { blurriness: r(front ? d * 0.18 : d * 0.08) } }];
      });
      c = setKeyframes(b.c, b.id, 'y', [[0, r(y)], [D, r(y - win.h * (0.02 + rand() * 0.03))]], 'linear');
      c = setKeyframes(c, b.id, 'opacity', [[0, 0], [0.8, r(front ? 0.3 : 0.35 + rand() * 0.15)]], 'easeOut');
    }
  }
  if (look.air === 'confetti') {
    const colours = [accent, '#ffffff', '#f2c14e', '#ff7aa2', '#7fd1c7'];
    const u = Math.min(W, H);
    for (let n = 0; n < 22; n++) {
      const w = u * (0.012 + rand() * 0.01);
      const x = win.x + win.w * (0.04 + rand() * 0.92);
      const y0 = win.y + win.h * (-0.04 + rand() * 0.5);
      const fall = win.h * (0.12 + rand() * 0.16);
      const y1 = Math.min(y0 + fall, L.captionZone.y - w * 2);
      const piece = shape(c, { x: x - w / 2, y: y0 - w, w, h: w * 1.8 }, colours[n % colours.length]!, 0.85, undefined, (l) => { l.transform.rotation = deg(rand() * 180); });
      c = setKeyframes(piece.c, piece.id, 'y', [[0, r(y0)], [D, r(y1)]], 'linear');
      c = setKeyframes(c, piece.id, 'rotation', [[0, 0], [D, deg((rand() > 0.5 ? 1 : -1) * (90 + rand() * 180))]], 'linear');
      c = setKeyframes(c, piece.id, 'opacity', [[0, 0], [0.4, 0.95]], 'easeOut');
    }
  }

  // the grade warms the photography and the pack together, under the type
  if (look.grade.opacity > 0) {
    c = shape(c, { x: 0, y: 0, w: W, h: H }, look.grade.color, 0.8, undefined, (l) => {
      l.blendMode = 'soft-light';
      l.transform.opacity = look.grade.opacity;
    }).c;
  }

  // the name over a soft fade, so it reads on any plate
  const z = L.captionZone;
  [0.08, 0.14, 0.2, 0.26].forEach((op, n) => {
    const top = n === 0 ? z.h * 0.25 : 0;
    c = shape(c, { x: z.x, y: z.y + (z.h * (3 - n)) / 4 - top, w: z.w, h: (z.h * (n + 1)) / 4 + top }, '#000000', 0.2, undefined, (l) => { l.transform.opacity = op; }).c;
  });
  const fit = Math.floor((z.w * 0.84) / (i.title.length * (look.name === 'bold' ? 0.6 : 0.52)));
  const nameSize = Math.min(Math.round(H * (look.name === 'bold' ? 0.027 : 0.022)), fit);
  const nameStyle =
    look.name === 'tracked-serif'
      ? { size: nameSize, weight: 400, color: '#ffffff', align: 'center' as const, font: FONT_SERIF }
      : { size: nameSize, weight: look.name === 'bold' ? 800 : 500, color: '#ffffff', align: 'center' as const };
  const name = add(c, { role: 'headline', kind: 'text', text: i.title, style: nameStyle, box: { x: z.x + z.w * 0.08, y: z.y + z.h * 0.28, w: z.w * 0.84, h: z.h * 0.3 } });
  c = look.name === 'tracked-serif' ? patch(name.c, name.id, (l) => { l.style.letterSpacing = 3; }) : name.c;
  const textIds = [name.id];
  if (i.subtitle) {
    const sub = add(c, { role: 'caption', kind: 'text', text: i.subtitle, style: { size: Math.round(nameSize * 0.82), weight: 400, color: '#f2f2f2', align: 'center' }, box: { x: z.x + z.w * 0.08, y: z.y + z.h * 0.58, w: z.w * 0.84, h: z.h * 0.26 } });
    c = sub.c;
    textIds.push(sub.id);
  }

  // price badge in the free slot: an accent shape around a white face, the shape from the look
  const { d, cx: bx, cy: by } = L.badge;
  const badgeIds: string[] = [];
  const put = (s: { c: Comp; id: string }) => ((c = s.c), s.id);
  if (d > 0) {
    const sq = (s: number): Rect => ({ x: bx - s / 2, y: by - s / 2, w: s, h: s });
    let face: { w: number; h: number };
    if (look.price === 'pill') {
      const ph = d * 0.46;
      badgeIds.push(put(shape(c, { x: bx - d / 2, y: by - ph / 2, w: d, h: ph }, accent, 0.6, { kind: 'rect', size: [d, ph], roundness: ph / 2 })));
      face = { w: d * 0.92, h: ph * 0.8 };
      badgeIds.push(put(shape(c, { x: bx - face.w / 2, y: by - face.h / 2, w: face.w, h: face.h }, '#ffffff', 0.55, { kind: 'rect', size: [face.w, face.h], roundness: face.h / 2 })));
    } else {
      const ring = look.price === 'burst' ? { kind: 'polystar', starType: 'star', points: 16, outerRadius: d / 2, innerRadius: d * 0.43 } : { kind: 'ellipse', size: [d, d] };
      const f = look.price === 'burst' ? 0.76 : 0.82;
      badgeIds.push(put(shape(c, sq(d), accent, 0.6, ring)));
      badgeIds.push(put(shape(c, sq(d * f), '#ffffff', 0.55, { kind: 'ellipse', size: [d * f, d * f] })));
      face = { w: d * f, h: d * f };
    }
    const priceText = formatPrice(i.price, i.currency);
    // the type fits the white face whatever the price length (about 0.62 em per heavy character)
    const priceSize = Math.min(Math.round(face.h * 0.48), Math.floor((face.w * 0.84) / (priceText.length * 0.62)));
    const was = i.wasPrice !== undefined && i.wasPrice > i.price && look.price !== 'pill' ? formatPrice(i.wasPrice, i.currency) : undefined;
    const py = was ? by + face.h * 0.08 : by;
    const price = add(c, { role: 'caption', kind: 'text', text: priceText, z: 0.5, style: { size: priceSize, weight: 800, color: '#111111', align: 'center' }, box: { x: bx - face.w * 0.48, y: py - priceSize * 0.6, w: face.w * 0.96, h: priceSize * 1.2 } });
    c = price.c;
    badgeIds.push(price.id);
    if (was) {
      const ws = Math.round(priceSize * 0.55);
      const wy = by - face.h * 0.24;
      const old = add(c, { role: 'caption', kind: 'text', text: was, z: 0.5, style: { size: ws, weight: 500, color: '#666666', align: 'center' }, box: { x: bx - face.w * 0.4, y: wy - ws * 0.6, w: face.w * 0.8, h: ws * 1.2 } });
      c = old.c;
      const lw = was.length * ws * 0.6;
      const strike = shape(c, { x: bx - lw / 2, y: wy - Math.max(2, ws * 0.06), w: lw, h: Math.max(3, ws * 0.12) }, '#c0152f', 0.45);
      c = strike.c;
      badgeIds.push(old.id, strike.id);
    }
  }

  const brandIds: string[] = [];
  if (i.brand && L.brand) {
    const b = L.brand;
    const tile = shape(c, b, accent, 0.4, { kind: 'rect', size: [b.w, b.h], roundness: b.w * 0.18 });
    c = tile.c;
    const mark = add(c, { role: 'caption', kind: 'text', text: i.brand, z: 0.3, style: { size: Math.min(Math.round(b.w * 0.2), Math.floor((b.w * 0.86) / (i.brand.length * 0.6))), weight: 800, color: '#ffffff', align: 'center' }, box: { x: b.x, y: b.y + b.h * 0.3, w: b.w, h: b.h * 0.4 } });
    c = mark.c;
    brandIds.push(tile.id, mark.id);
  }

  // motion. The scale is relative to the fitted size and y moves with it, so the base stays on the table.
  const k = L.pack.w / i.product.width;
  const bottom = L.pack.y + L.pack.h;
  const hero: Array<[number, number]> =
    look.hero === 'drop' ? [[0, 0], [0.45, 0], [0.75, 1.06], [0.95, 1], [D, 1.02]] : look.hero === 'push' ? [[0, 1], [D, 1.03]] : [[0, 0.92], [0.7, 1], [D, 1.04]];
  const arrive: Array<[number, number]> = look.hero === 'drop' ? [[0, 0], [0.45, 0], [0.5, 1]] : look.hero === 'push' ? [[0, 0], [0.5, 1]] : [[0, 0], [0.3, 1]];
  const scaleKeys = hero.map(([t, v]) => [t, r(v * k * 1e4) / 1e4] as [number, number]);
  const yKeys = hero.map(([t, v]) => [t, r(bottom - (v * L.pack.h) / 2)] as [number, number]);
  for (const id of [packId, ...followers]) {
    c = setKeyframes(c, id, 'scale', scaleKeys, 'easeOut');
    c = setKeyframes(c, id, 'y', yKeys, 'easeOut');
  }
  if (softPackId) {
    // the rack: the soft pack dissolves into the sharp one as the room goes soft
    c = setKeyframes(c, packId, 'opacity', [[0, 0], [0.4, 0], [1.1, 1]], 'easeInOut');
    c = setKeyframes(c, softPackId, 'opacity', [[0, 0], [0.3, 1], [1.1, 0]], 'easeInOut');
  } else c = setKeyframes(c, packId, 'opacity', arrive, 'easeOut');
  for (const id of followers.filter((f) => f !== softPackId)) c = setKeyframes(c, id, 'opacity', arrive, 'easeOut');
  if (reflectionId) {
    c = setKeyframes(c, reflectionId, 'scale', scaleKeys, 'easeOut');
    c = setKeyframes(c, reflectionId, 'y', hero.map(([t, v]) => [t, r(bottom + (v * L.pack.h) / 2)] as [number, number]), 'easeOut');
    c = patch(c, reflectionId, (l) => { l.transform.scale = (l.transform.scale as Array<{ v: number[] }>).map((f) => ({ ...f, v: [f.v[0]!, -f.v[1]!] })); });
    c = setKeyframes(c, reflectionId, 'opacity', arrive.map(([t, v]) => [t, r(v * 0.24)] as [number, number]), 'easeOut');
  }
  if (shadowId) c = setKeyframes(c, shadowId, 'scale', hero, 'easeOut');
  const pulse = pulseKeys(D, i.bpm ?? 120, look.pop);
  for (const id of badgeIds) c = setKeyframes(c, id, 'scale', pulse, look.pop === 'slam' ? 'easeOut' : 'easeInOut');
  for (const id of textIds) c = setKeyframes(c, id, 'opacity', [[0, 0], [1, 0], [1.4, 1]], 'easeOut');
  for (const id of brandIds) c = setKeyframes(c, id, 'opacity', [[0, 0], [0.6, 0], [1, 1]], 'easeOut');
  return c;
}
