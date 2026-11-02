// The price as a sale sticker, not a line of type: a turning starburst, a disc in the film's lead colour, a ring, the price
// large and the old price under it. The price leaves the plain text it came from, so it is said once. Pure; every layer it
// adds has a `finish:` id, so the finish pass removes and redraws it.
import { parsePrice } from '@shared/catalog';
import { bestFlatTextColor, parseColor, relLuminance } from '../review/contrast';
import { layerBoxAt } from '../review/geometry';
import type { Box } from '../review/types';
import { removeLayer } from './layers';
import { readDirector } from './meta';
import type { Comp, Obj } from './types';

const PRICE_G = /(?:[$€£]\s?\d{1,6}(?:[.,]\d{1,2})?|\d{1,6}(?:[.,]\d{1,2})?\s?(?:USD|EUR|GBP|CAD|AUD))/g;
/** Words that only frame a price, and go with it. */
const PRICE_WORDS = /\b(?:now|was|only|just|from|from only|sale price|price)\b/gi;
/** The badge's diameter as a share of the frame's shorter side. */
export const BADGE_SHARE = 0.34;
/** Frames from the badge's first frame to the top of its pop, and to rest. */
const POP = [0, 8, 12, 16] as const;
const POP_SCALE = [0, 1.18, 0.95, 1] as const;

export interface BadgePrice {
  now: string;
  was?: string;
}

const SAFE = 0.05;
const area = (b: Box) => Math.max(0, b.right - b.left) * Math.max(0, b.bottom - b.top);
const overlapArea = (a: Box, b: Box) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

/** The sale price and the old price a piece of copy names. "WAS $18" marks the old one; else the dearer of two is the old one. */
export function readPrices(text: string): BadgePrice | undefined {
  const flat = text.replace(/\n/g, ' ');
  const found = [...flat.matchAll(PRICE_G)].map((m) => ({ text: m[0].trim(), at: m.index ?? 0, amount: parsePrice(m[0].trim()) }));
  if (!found.length) return undefined;
  const wasIdx = found.findIndex((f) => /\bwas\s*$/i.test(flat.slice(Math.max(0, f.at - 6), f.at)));
  if (wasIdx >= 0) {
    const was = found[wasIdx]!;
    const now = found.find((_, i) => i !== wasIdx);
    return now ? { now: now.text, was: was.text } : { now: was.text };
  }
  if (found.length >= 2 && (found[1]!.amount ?? 0) > (found[0]!.amount ?? 0)) return { now: found[0]!.text, was: found[1]!.text };
  return { now: found[0]!.text };
}

/** The copy with its prices and price words taken out, and the separators they leave tidied away. */
export function withoutPrices(text: string): string {
  return text
    .split('\n')
    .join(' ')
    .replace(PRICE_G, ' ')
    .replace(PRICE_WORDS, ' ')
    .replace(/\s*[—–\-|·:,]+\s*(?=[—–\-|·:,]|$)/g, ' ')
    .replace(/^\s*[—–\-|·:,]+\s*/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

const pop = (t0: number, at: (s: number) => [number, number]) => POP.map((d, i) => ({ t: t0 + d, v: at(POP_SCALE[i]!), ...(i < POP.length - 1 ? { easeOut: [0.3, 0, 0.4, 1] } : {}) }));

function badgeLayers(sceneId: string, frame: { w: number; h: number; frames: number }, cx: number, cy: number, d: number, price: BadgePrice, colour: string, font: string): Obj[] {
  const frames = frame.frames;
  const r = d / 2;
  const ink = bestFlatTextColor(relLuminance(parseColor(colour))).color;
  const t0 = Math.min(12, Math.floor(frames / 4));
  const id = (part: string) => `finish:${sceneId}:badge-${part}`;
  const base = (part: string, extra: Obj) => ({ id: id(part), name: `price badge ${part}`, inPoint: t0, outPoint: frames, ...extra });
  const centred = (size: number, rot: number | Obj[] = -10) => ({ position: [cx, cy], anchor: [size / 2, size / 2], scale: pop(t0, (s) => [s, s]), rotation: rot, opacity: 1 });
  const burstR = r * 1.12;
  const ringIn = d * 0.84 - 2 * Math.max(3, Math.round(d * 0.012));
  const nowSize = Math.round(Math.min(d * 0.3, (d * 0.78) / Math.max(1, price.now.length * 0.6)));
  const wasSize = Math.round(d * 0.105);
  const layers: Obj[] = [
    base('burst', {
      kind: 'shape',
      path: { kind: 'polystar', starType: 'star', points: 20, outerRadius: burstR, innerRadius: r * 0.98 },
      fill: '#FFFFFF',
      effects: [{ name: 'drop-shadow', params: { distance: 14, direction: 180, softness: 22, opacity: 0.35, color: '#000000' } }],
      transform: { ...centred(burstR * 2), rotation: [{ t: t0, v: -10 }, { t: frames, v: 20 }] },
    }),
    base('disc', { kind: 'shape', path: { kind: 'ellipse', size: [d, d] }, fill: colour, transform: centred(d) }),
    // the inner ring is two filled discs: an unfilled ellipse is drawn filled by the engine
    base('ring', { kind: 'shape', path: { kind: 'ellipse', size: [d * 0.84, d * 0.84] }, fill: ink, transform: centred(d * 0.84) }),
    base('ring-in', { kind: 'shape', path: { kind: 'ellipse', size: [ringIn, ringIn] }, fill: colour, transform: centred(ringIn) }),
  ];
  // text is centred on its position: the price sits a little high when an old price goes under it, and both ride the pop
  const nowDy = price.was ? -d * 0.06 : 0;
  const text = (part: string, source: string, size: number, dy: number, weight: number): Obj =>
    base(part, {
      kind: 'text',
      source,
      style: { font, size, fill: ink, weight, align: 'center' },
      transform: {
        position: pop(t0, (s) => [cx, cy + dy * s]),
        // text anchors are the frame centre, the way the builder places them (placement.ts boxToText)
        anchor: [frame.w / 2, frame.h / 2],
        scale: pop(t0, (s) => [s, s]),
        rotation: -10,
        opacity: 1,
      },
    });
  layers.push(text('now', price.now, nowSize, nowDy, 900));
  if (price.was) layers.push(text('was', `WAS ${price.was}`, wasSize, d * 0.2, 700));
  return layers;
}

/** The badge's centre: the first spot, of a few around the frame, that keeps clear of the copy and covers the least of the product. */
function placeBadge(c: Comp, sceneId: string, precompId: string, d: number): [number, number] {
  const p = (c.precomps as Record<string, Obj>)[precompId]!;
  const W = p.width as number;
  const H = p.height as number;
  const meta = readDirector(c);
  const scene = meta.scenes[sceneId]!;
  const ids = ((p.layers as Obj[]).filter((l) => meta.layers[l.id]?.sceneId === sceneId) as Obj[]).map((l) => ({ id: l.id as string, role: meta.layers[l.id]!.role }));
  // the copy and the product at rest and through the shot, so a caption that slides in late still counts
  const frames = [0.25, 0.5, 0.75, 1].map((k) => Math.min(scene.durationFrames - 1, Math.round(k * scene.durationFrames)));
  const boxes = (role: (r: string) => boolean) =>
    frames.flatMap((f) =>
      ids.filter((x) => role(x.role)).flatMap((x) => {
        try {
          const b = layerBoxAt(c, x.id, f);
          return b.visible && b.opacity >= 0.3 ? [b.box] : [];
        } catch {
          return [];
        }
      }),
    );
  const texts = boxes((r) => r === 'headline' || r === 'caption');
  const products = boxes((r) => r === 'product' || r === 'product3d');
  const r = d / 2;
  const reach = r * 1.12;
  const clampTo = (v: number, size: number) => Math.min(Math.max(v, SAFE * size + reach), (1 - SAFE) * size - reach);
  // a grid over the frame, the lower right first: where a sale sticker is looked for
  const spots: Array<[number, number]> = [];
  for (const y of [0.62, 0.7, 0.54, 0.78, 0.46, 0.86, 0.38, 0.3]) for (const x of [0.72, 0.28, 0.5, 0.8, 0.2]) spots.push([clampTo(x * W, W), clampTo(y * H, H)]);
  let best = spots[0]!;
  let bestScore = Infinity;
  for (const [x, y] of spots) {
    const b = { left: x - reach, top: y - reach, right: x + reach, bottom: y + reach };
    // covering copy is never worth it; covering some of the product is how a sticker sits
    const textCover = texts.reduce((n, t) => n + overlapArea(b, t) / area(b), 0);
    const productCover = products.reduce((n, t) => n + overlapArea(b, t) / area(b), 0) / Math.max(1, frames.length);
    const score = 100 * textCover + Math.max(0, productCover - 0.35);
    if (score < bestScore - 1e-6) [best, bestScore] = [[x, y], score];
  }
  return best;
}

/**
 * Turns the price in each shot's copy into a badge. `prior` carries the prices of badges a previous finish drew, so a second
 * pass redraws them although the copy no longer names them. `refit` re-wraps copy that lost its price.
 */
export function priceBadges(input: Comp, o: { accent?: string; prior?: Record<string, BadgePrice>; refit?: (layer: Obj, frameW: number) => void } = {}): Comp {
  let c = input;
  const meta = readDirector(c);
  const colour = o.accent ?? '#E63946';
  for (const [sceneId, scene] of Object.entries(meta.scenes)) {
    if (scene.mode === 'generate') continue;
    const p = () => (c.precomps as Record<string, Obj>)[scene.precompId]!;
    if (!p()) continue;
    const copy = (p().layers as Obj[]).filter((l) => l.kind === 'text' && readDirector(c).layers[l.id]?.sceneId === sceneId && typeof l.source === 'string');
    const named = copy.map((l) => readPrices(l.source)).find(Boolean);
    const price = named ?? o.prior?.[sceneId];
    if (!price) continue;
    for (const l of copy) {
      if (!readPrices(l.source)) continue;
      const rest = withoutPrices(l.source);
      if ((rest.match(/[a-z]/gi) ?? []).length < 3) c = removeLayer(c, l.id);
      else {
        const live = (p().layers as Obj[]).find((x) => x.id === l.id)!;
        live.source = rest;
        o.refit?.(live, p().width);
      }
    }
    const font = (copy.find((l) => readDirector(c).layers[l.id]?.role === 'headline')?.style?.font as string | undefined) ?? 'Inter, system-ui, sans-serif';
    const d = Math.round(Math.min(p().width, p().height) * BADGE_SHARE);
    const [cx, cy] = placeBadge(c, sceneId, scene.precompId, d);
    (p().layers as Obj[]).push(...badgeLayers(sceneId, { w: p().width, h: p().height, frames: scene.durationFrames }, cx, cy, d, price, colour, font));
  }
  return c;
}

/** The prices the badges of an earlier finish show, by scene. */
export function priorBadges(c: Comp): Record<string, BadgePrice> {
  const out: Record<string, BadgePrice> = {};
  for (const [sceneId, scene] of Object.entries(readDirector(c).scenes)) {
    const layers = (((c.precomps as Record<string, Obj>)[scene.precompId]?.layers ?? []) as Obj[]);
    const now = layers.find((l) => l.id === `finish:${sceneId}:badge-now`)?.source;
    const was = layers.find((l) => l.id === `finish:${sceneId}:badge-was`)?.source;
    if (typeof now === 'string') out[sceneId] = { now, ...(typeof was === 'string' ? { was: was.replace(/^WAS\s+/, '') } : {}) };
  }
  return out;
}
