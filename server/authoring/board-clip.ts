import { formatPrice } from '@shared/catalog';
import { ASPECT_SIZES } from '@shared/composition';
import type { CatalogBoard, CbShot } from './catalog-board';
import { newFilmComposition, registerAsset } from './composition';
import { sceneMeta } from './meta';
import { shade, type ClipAsset } from './retail-clip';
import { addScene } from './scenes';
import { setKeyframes } from './transform';
import type { Aspect, Comp, Ease } from './types';
import { add, inkOn, patch, shape, tint, words } from './variant-film';

// The hero film of one catalogue product: a catalog board (catalog-board.ts) played in 2D over the real cut-out, for any product
// shape. One scene holds the whole film (a scene is at least 1 s and the references cut every 0.4-1.0 s); each shot is a set of
// layers shown only inside its own frames, so a cut is a clean frame-exact switch. Per shot: the world (a colour field, a halo or
// the painted plate), the product at the shot's size with its entrance and its one move, the air, the words; the last shot is the
// end card: the price disc pops on the beat, the name, the brand and the tagline type in, and it holds.
// docs/direction/corpus/01-ad-laws.md, 04-motion-and-edit.md, 06-reference-films.md. Pure and deterministic.

export interface BoardClipInput {
  aspect: Aspect;
  board: CatalogBoard;
  product: ClipAsset;
  /** The painted plate of the product's look, for the shots whose world is `plate`; without it they use the halo. */
  plate?: ClipAsset;
  title: string;
  price: number;
  wasPrice?: number;
  currency?: string;
  brand?: string;
  /** The photo's colour: the fields, the halo and the price disc are made from it. */
  accent: string;
}

const SCENE = 'hero';
const r = (n: number) => Math.round(n * 1e4) / 1e4;

/** Mixes two hex colours: f = 0 is a, 1 is b. */
function mix(a: string, b: string, f: number): string {
  const p = (h: string) => parseInt(h.replace('#', '').padEnd(6, '0').slice(0, 6), 16);
  const x = p(a);
  const y = p(b);
  const ch = (s: number) => Math.round(((x >> s) & 255) * (1 - f) + ((y >> s) & 255) * f).toString(16).padStart(2, '0');
  return `#${ch(16)}${ch(8)}${ch(0)}`;
}

/** A small seeded random, so the air of a shot is the same every build. */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** The product's height as a share of the frame, and its width cap, per shot size. Macro is the medium size times 2.5. */
const SIZE: Record<Exclude<CbShot['size'], 'macro'>, { h: number; w: number }> = {
  wide: { h: 0.26, w: 0.55 },
  medium: { h: 0.46, w: 0.8 },
  close: { h: 0.66, w: 0.95 },
};
const MACRO = 2.5;

/** The scale at the start and the end of a shot, as a multiple of its size: push in, pull out (the payoff), hold, sway. */
const MOVE: Record<CbShot['move'], [number, number]> = {
  push: [1, 1.12],
  pull: [1.2, 1],
  hold: [1, 1.03],
  sway: [1, 1.05],
  'dolly-zoom': [1, 1],
};

export function buildBoardClip(i: BoardClipInput): Comp {
  const shots = i.board.shots;
  if (!shots.length) throw new Error('a hero film needs at least one shot');
  const { width: W, height: H } = ASPECT_SIZES[i.aspect];
  const u = Math.min(W, H);
  const portrait = H > W;
  let c = newFilmComposition({ aspect: i.aspect, title: `${i.brand ?? i.title}: ${i.board.concept || 'hero film'}`.slice(0, 120), palette: [i.accent] });
  c = registerAsset(c, { id: i.product.id, kind: 'image', src: i.product.src, width: i.product.width, height: i.product.height });
  if (i.plate) c = registerAsset(c, { id: i.plate.id, kind: 'image', src: i.plate.src, width: i.plate.width, height: i.plate.height });
  const fps = c.fps as number;

  // shot boundaries, snapped to frames
  const bounds: Array<[number, number]> = [];
  let f = 0;
  for (const s of shots) {
    const n = Math.max(Math.round(0.4 * fps), Math.round(s.seconds * fps));
    bounds.push([f, f + n]);
    f += n;
  }
  const total = Math.max(1, f / fps);
  c = addScene(c, { id: SCENE, durationSec: Math.round(total * 1000) / 1000, mode: 'motion', intent: `Hero film: ${shots.map((s) => `${s.size} ${s.move}`).join(', ')}` });
  const F = sceneMeta(c, SCENE).durationFrames;
  bounds[bounds.length - 1]![1] = F;

  /** Keys in frames, snapped, clamped to the scene and one per frame (the last value on a frame wins). */
  type Prop = 'x' | 'y' | 'scale' | 'rotation' | 'opacity';
  const keysAt = (c0: Comp, id: string, prop: Prop, pts: Array<[number, number]>, ease: Ease = 'easeOut'): Comp => {
    const byFrame = new Map<number, number>();
    for (const [fr, v] of [...pts].sort((a, b) => a[0] - b[0])) byFrame.set(Math.min(F, Math.max(0, Math.round(fr))), v);
    const list = [...byFrame.entries()].sort((a, b) => a[0] - b[0]).map(([fr, v]) => [r(fr / fps), r(v)] as [number, number]);
    return setKeyframes(c0, id, prop, list, ease);
  };
  /** Shown only inside [f0, f1): a frame-exact cut in and out. `inner` adds keys inside the window (a fade, a pop). */
  const window = (f0: number, f1: number, inner: Array<[number, number]> = [[f0, 1]]): Array<[number, number]> => {
    const out: Array<[number, number]> = [];
    if (f0 > 0) out.push([f0 - 1, 0]);
    out.push(...inner);
    if (f1 < F) out.push([f1 - 1, inner.at(-1)?.[1] ?? 1], [f1, 0]);
    return out;
  };

  // the colour world: the photo's colour, set by the key (dark, mid, bright) and warmed or cooled by the tone
  const toned = i.board.tone === 'warm' ? mix(i.accent, '#ffb36b', 0.18) : i.board.tone === 'cool' ? mix(i.accent, '#6fb6ff', 0.18) : i.accent;
  // three fields per film, so the world changes material from shot to shot while the colour family holds; a bright (high key)
  // film stays saturated enough to read as colour, not as an empty pastel
  const palette =
    i.board.key === 'low'
      ? [shade(toned, 0.78), shade(toned, 0.62), shade(toned, 0.86)]
      : i.board.key === 'high'
        ? [tint(toned, 0.42), tint(toned, 0.18), shade(toned, 0.12)]
        : [toned, tint(toned, 0.3), shade(toned, 0.38)];

  const pw0 = i.product.width;
  const ph0 = i.product.height;
  const kOf = (size: CbShot['size']): number => {
    const s = SIZE[size === 'macro' ? 'medium' : size];
    const k = Math.min((s.h * H) / ph0, (s.w * W) / pw0);
    return size === 'macro' ? k * MACRO : k;
  };

  const sceneLayers = (cc: Comp): Array<{ id: string; inPoint?: number; outPoint?: number }> =>
    ((cc.precomps as Record<string, { layers: Array<{ id: string; inPoint?: number; outPoint?: number }> }>)[SCENE]!.layers);

  shots.forEach((shot, n) => {
    const [f0, f1] = bounds[n]!;
    const before = new Set(sceneLayers(c).map((l) => l.id));
    // a layer of this shot lives in [f0, f1] only and the player times its keys from f0, so every key is held inside the shot
    const keys = (c0: Comp, id: string, prop: Prop, pts: Array<[number, number]>, ease: Ease = 'easeOut'): Comp =>
      keysAt(c0, id, prop, pts.map(([fr, v]) => [Math.min(f1, Math.max(f0, fr)), v] as [number, number]), ease);
    const last = n === shots.length - 1;
    const dur = f1 - f0;
    const enter = Math.min(Math.round(0.45 * fps), Math.floor(dur * 0.5));
    const fE = f0 + enter;
    const field = palette[n % palette.length]!;
    // the end card always sits on the field and halo: the price, the name and the tagline must read
    const plateWorld = shot.world === 'plate' && i.plate && !last;
    const ink = plateWorld ? '#ffffff' : inkOn(field);
    const zoom = shot.move === 'dolly-zoom';

    // the world
    const bg = shape(c, SCENE, { x: 0, y: 0, w: W, h: H }, field, 12);
    c = keys(bg.c, bg.id, 'opacity', window(f0, f1), 'linear');
    if (shot.cut === 'whip') c = keys(c, bg.id, 'x', [[f0, W * 1.5], [f0 + 4, W / 2]], 'easeOut');
    if (plateWorld) {
      const k = Math.max(W / i.plate!.width, H / i.plate!.height) * 1.04;
      const pl = add(c, SCENE, { role: 'bg', kind: 'image', assetId: i.plate!.id, z: 11.5, box: { x: 0, y: 0, w: W, h: H } }, true);
      c = patch(pl.c, SCENE, pl.id, (l) => {
        l.effects = [{ name: 'gaussian-blur', params: { blurriness: shot.size === 'wide' ? 2 : 5 } }];
      });
      c = keys(c, pl.id, 'opacity', window(f0, f1), 'linear');
      c = keys(c, pl.id, 'scale', [[f0, k], [f1, k * (zoom ? 1.35 : shot.move === 'pull' ? 0.97 : 1.06)]], zoom ? 'easeInOut' : 'linear');
    } else if (shot.world === 'halo' || shot.world === 'plate' || last) {
      const hd = Math.min(W, H) * (shot.size === 'wide' ? 0.6 : 0.95);
      const cy = H * (shot.size === 'wide' ? 0.6 : 0.52);
      const halo = shape(c, SCENE, { x: W / 2 - hd / 2, y: cy - hd / 2, w: hd, h: hd }, tint(field, 0.62), 11, { kind: 'ellipse', size: [hd, hd] }, (l) => {
        l.effects = [{ name: 'gaussian-blur', params: { blurriness: r(hd * 0.09) } }];
      });
      c = keys(halo.c, halo.id, 'opacity', window(f0, f1, [[f0, 0.55], [f0 + dur * 0.5, 0.95], [f1 - 1, 0.75]]), 'easeInOut');
      c = keys(c, halo.id, 'scale', [[f0, 0.85], [f1, zoom ? 1.45 : 1.08]], zoom ? 'easeInOut' : 'easeOut');
    }

    // the air
    if (shot.air !== 'none' && !last) {
      const rand = rng(n * 7919 + shot.air.length * 31);
      const count = shot.air === 'confetti' ? 16 : shot.air === 'bokeh' ? 8 : 18;
      for (let a = 0; a < count; a++) {
        const x = W * (0.05 + rand() * 0.9);
        const y = H * (0.08 + rand() * 0.84);
        if (shot.air === 'confetti') {
          const w = u * 0.014;
          const h = u * 0.026;
          const col = [i.accent, tint(i.accent, 0.5), '#ffffff', '#ffd166'][a % 4]!;
          const p = shape(c, SCENE, { x: x - w / 2, y: -h, w, h }, col, 0.5);
          c = keys(p.c, p.id, 'opacity', window(f0, f1), 'linear');
          c = keys(c, p.id, 'y', [[f0, y - H * 0.7], [f1, y + H * 0.15]], 'linear');
          c = keys(c, p.id, 'rotation', [[f0, rand() * 180], [f1, 360 + rand() * 360]], 'linear');
        } else {
          const d = shot.air === 'bokeh' ? u * (0.04 + rand() * 0.07) : u * (0.005 + rand() * 0.006);
          const col = shot.air === 'bokeh' ? tint(field, 0.85) : '#fff4d6';
          const op = shot.air === 'bokeh' ? 0.18 + rand() * 0.14 : 0.45 + rand() * 0.3;
          const p = shape(c, SCENE, { x: x - d / 2, y: y - d / 2, w: d, h: d }, col, shot.air === 'bokeh' ? 0.4 : 9, { kind: 'ellipse', size: [d, d] }, (l) => {
            if (shot.air === 'bokeh') l.effects = [{ name: 'gaussian-blur', params: { blurriness: r(d * 0.25) } }];
          });
          c = keys(p.c, p.id, 'opacity', window(f0, f1, [[f0, op]]), 'linear');
          c = keys(c, p.id, 'y', [[f0, y], [f1, y - H * (shot.air === 'bokeh' ? 0.06 : 0.03)]], 'linear');
          c = keys(c, p.id, 'x', [[f0, x], [f1, x + W * (shot.air === 'dust' ? 0.03 : 0.01)]], 'linear');
        }
      }
    }

    // the product
    const k = kOf(shot.size);
    const [m0, m1] = MOVE[shot.move];
    const cx = last ? W * (portrait ? 0.42 : 0.38) : W / 2;
    const cy = last ? H * 0.5 : shot.size === 'wide' ? H * 0.62 : shot.size === 'macro' ? H * 0.5 + ph0 * k * 0.06 : H * 0.54;
    const kk = last ? Math.min((0.4 * H) / ph0, (0.55 * W) / pw0) : k;
    const pr = add(c, SCENE, { role: 'product', kind: 'image', assetId: i.product.id, box: { x: cx - (pw0 * kk) / 2, y: cy - (ph0 * kk) / 2, w: pw0 * kk, h: ph0 * kk } });
    c = patch(pr.c, SCENE, pr.id, (l) => {
      l.effects = [{ name: 'drop-shadow', params: { distance: 22, direction: 180, softness: 34, opacity: shot.size === 'macro' ? 0.2 : 0.38, color: '#000000' } }];
    });
    c = keys(c, pr.id, 'opacity', window(f0, f1), 'linear');
    const scale: Array<[number, number]> = [];
    if (shot.entrance === 'tumble') scale.push([f0, kk * 0.2], [f0 + enter * 0.7, kk * m0 * 1.08], [fE, kk * m0]);
    else scale.push([f0, kk * m0]);
    scale.push([f1, kk * (zoom ? 1 : m1)]);
    c = keys(c, pr.id, 'scale', scale, 'easeOut');
    const rot: Array<[number, number]> = [];
    const side = n % 2 === 0 ? -1 : 1;
    if (shot.entrance === 'tumble') rot.push([f0, side * 22], [f0 + enter * 0.7, -side * 4], [fE, 0]);
    if (shot.move === 'sway') rot.push([Math.max(fE, f0 + 1), 0], [f0 + dur * 0.55, side * 4], [f1, -side * 2]);
    if (rot.length) c = keys(c, pr.id, 'rotation', rot, shot.move === 'sway' ? 'easeInOut' : 'easeOut');
    if (shot.entrance === 'drop') c = keys(c, pr.id, 'y', [[f0, cy - H * 0.6], [f0 + enter * 0.7, cy + u * 0.015], [fE, cy]], 'easeIn');
    const fromSide = shot.entrance === 'slide' || shot.cut === 'whip';
    if (fromSide) c = keys(c, pr.id, 'x', [[f0, cx + side * W * 0.9], [f0 + (shot.entrance === 'slide' ? enter : 5), cx]], 'easeOut');

    // the words of the shot: in the upper third, word by word, gone before the cut
    if (shot.text && !last) {
      const cyT = H * (portrait ? 0.18 : 0.15);
      const t = words(c, SCENE, shot.text, { cx: W / 2, cy: cyT, maxW: W * 0.84, size: Math.round(u * 0.085), color: ink, boldLast: true, z: 0.2 });
      c = t.c;
      // a soft shadow under every word, so a line reads over a busy plate as well as over a field
      for (const id of t.ids)
        c = patch(c, SCENE, id, (l) => {
          l.effects = [{ name: 'drop-shadow', params: { distance: 3, direction: 180, softness: 14, opacity: ink === '#ffffff' ? 0.55 : 0.18, color: '#000000' } }];
        });
      t.ids.forEach((id, w) => {
        const a = f0 + 3 + w * 3.6;
        const out = Math.max(a + 8, f1 - 4);
        c = keys(c, id, 'opacity', window(f0, f1, [[f0, 0], [a, 0], [a + 7, 1], [out, 1], [Math.min(f1 - 1, out + 3), 0]]), 'easeOut');
        c = keys(c, id, 'y', [[f0, cyT + 14], [a, cyT + 14], [a + 9, cyT]], 'easeOut');
      });
    }

    // the flash: a burst of light that fades off the first frames of the shot
    if (shot.cut === 'flash') {
      const fl = shape(c, SCENE, { x: 0, y: 0, w: W, h: H }, '#ffffff', 0.05);
      c = keys(fl.c, fl.id, 'opacity', [[0, 0], [Math.max(0, f0 - 1), 0], [f0, 0.9], [f0 + 9, 0]], 'easeOut');
    }

    // the end card: the price lands on the beat, then the name, the brand and the tagline, and it holds
    if (last) {
      const beat = f0 + Math.round(0.3 * fps);
      const d = u * 0.25;
      const dx = W * (portrait ? 0.77 : 0.72);
      const dy = H * (portrait ? 0.42 : 0.4);
      const disc = shape(c, SCENE, { x: dx - d / 2, y: dy - d / 2, w: d, h: d }, i.accent, 0.3, { kind: 'ellipse', size: [d, d] }, (l) => {
        l.effects = [{ name: 'drop-shadow', params: { distance: 10, direction: 180, softness: 24, opacity: 0.3, color: '#000000' } }];
      });
      c = keys(disc.c, disc.id, 'scale', [[f0, 0], [beat, 0], [beat + 6, 1.18], [beat + 11, 1]], 'easeOut');
      c = keys(c, disc.id, 'opacity', window(f0, f1), 'linear');
      const text = formatPrice(i.price, i.currency);
      const ps = Math.round(Math.min(u * 0.075, (d * 0.86) / (text.length * 0.6)));
      const pt = add(c, SCENE, { role: 'caption', kind: 'text', text, z: 0.2, style: { size: ps, weight: 800, color: inkOn(i.accent), align: 'center' }, box: { x: dx - d / 2, y: dy - ps * 0.6, w: d, h: ps * 1.2 } });
      c = keys(pt.c, pt.id, 'scale', [[f0, 0], [beat, 0], [beat + 6, 1.18], [beat + 11, 1]], 'easeOut');
      c = keys(c, pt.id, 'opacity', window(f0, f1), 'linear');
      if (i.wasPrice !== undefined && i.wasPrice > i.price) {
        const was = formatPrice(i.wasPrice, i.currency);
        const ws = Math.round(ps * 0.5);
        const wy = dy - d / 2 - ws * 0.9;
        const old = add(c, SCENE, { role: 'caption', kind: 'text', text: was, z: 0.2, style: { size: ws, weight: 600, color: ink, align: 'center' }, box: { x: dx - d / 2, y: wy - ws * 0.6, w: d, h: ws * 1.2 } });
        c = keys(old.c, old.id, 'opacity', window(f0, f1, [[f0, 0], [beat + 8, 0], [beat + 14, 0.85]]), 'easeOut');
        const lw = was.length * ws * 0.56;
        const line = shape(c, SCENE, { x: dx - lw / 2, y: wy - Math.max(2, ws * 0.05), w: lw, h: Math.max(3, ws * 0.1) }, '#ff5a6e', 0.15);
        c = keys(line.c, line.id, 'opacity', window(f0, f1, [[f0, 0], [beat + 14, 0], [beat + 19, 1]]), 'easeOut');
      }
      // the name, slim and small under the product (law 10: quiet type, loud price)
      const ny = H * (portrait ? 0.76 : 0.82);
      const ns = Math.round(u * 0.048);
      const name = add(c, SCENE, { role: 'caption', kind: 'text', text: i.title, z: 0.2, style: { size: ns, weight: 500, color: ink, align: 'center' }, box: { x: W * 0.08, y: ny - ns * 0.6, w: W * 0.84, h: ns * 1.2 } });
      c = keys(name.c, name.id, 'opacity', window(f0, f1, [[f0, 0], [beat + 6, 0], [beat + 14, 1]]), 'easeOut');
      c = keys(c, name.id, 'y', [[f0, ny + 12], [beat + 6, ny + 12], [beat + 16, ny]], 'easeOut');
      // the tagline, word by word, the last word bold, then the brand under it
      const ty = H * (portrait ? 0.17 : 0.14);
      const tg = words(c, SCENE, i.board.tagline, { cx: W / 2, cy: ty, maxW: W * 0.86, size: Math.round(u * 0.08), color: ink, boldLast: true, z: 0.2 });
      c = tg.c;
      tg.ids.forEach((id, w) => {
        const a = beat + 10 + w * 4;
        c = keys(c, id, 'opacity', window(f0, f1, [[f0, 0], [a, 0], [a + 7, 1]]), 'easeOut');
        c = keys(c, id, 'y', [[f0, ty + 14], [a, ty + 14], [a + 9, ty]], 'easeOut');
      });
      if (i.brand) {
        const by = ty + u * 0.085;
        const bs = Math.round(u * 0.036);
        const br = add(c, SCENE, { role: 'caption', kind: 'text', text: i.brand, z: 0.2, style: { size: bs, weight: 700, color: ink, align: 'center' }, box: { x: W * 0.2, y: by - bs * 0.6, w: W * 0.6, h: bs * 1.2 } });
        const a = beat + 14 + tg.ids.length * 4;
        c = keys(br.c, br.id, 'opacity', window(f0, f1, [[f0, 0], [a, 0], [a + 8, 0.9]]), 'easeOut');
      }
    }

    // the shot's layers live only inside the shot: the player skips them (and their blurs and shadows) everywhere else
    c = structuredClone(c);
    for (const l of sceneLayers(c)) {
      if (before.has(l.id)) continue;
      l.inPoint = f0;
      l.outPoint = f1;
    }
  });
  return c;
}
