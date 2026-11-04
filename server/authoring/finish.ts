import { parsePrice } from '@shared/catalog';
import { setCamera } from './camera';
import { isAnimated } from './keyframes';
import { addLayer } from './layers';
import { readDirector } from './meta';
import { separateText } from './text-collide';
import { priceBadges, priorBadges } from './price-badge';
import type { Comp, Obj } from './types';

// Deterministic finishing pass for a built film (S17 polish): contact shadow under the product, a warm grade,
// ad-grade type and a music bed. Pure and idempotent: layers it adds carry the `finish:` id prefix and are replaced on a re-run.
const PREFIX = 'finish:';

export interface FinishOptions {
  /** Warm grade colour laid over every shot. */
  grade?: string;
  /** Registered audio asset id for the music bed; the layer is added only when given. */
  musicAssetId?: string;
  /** Bed level 0..1. */
  musicLevel?: number;
  /** The film's brief: a price named in it that no text layer shows is added to the last scene. */
  brief?: string;
  /** The colour of the wipe that carries each cut (the style bible's lead colour). */
  accent?: string;
}

/** Frames each half of a cut's wipe takes: the panel covers the end of one shot and uncovers the start of the next. */
export const WIPE_FRAMES = 7;
const CAMERA_ROLES = new Set(['bg', 'product', 'product3d', 'subject', 'clip']);

/** A shot the director left static gets a slow push, unless a layer the camera would move is already animated by hand. */
function pushStaticShots(c: Comp): Comp {
  let out = c;
  const meta = readDirector(c);
  for (const [sceneId, scene] of Object.entries(meta.scenes)) {
    if (scene.mode === 'generate' || scene.camera?.move !== 'static') continue;
    const layers = ((c.precomps as Record<string, Obj>)[scene.precompId]?.layers ?? []) as Obj[];
    const handAnimated = layers.some((l) => CAMERA_ROLES.has(meta.layers[l.id]?.role ?? '') && (isAnimated(l.transform?.position) || isAnimated(l.transform?.scale)));
    if (!handAnimated) out = setCamera(out, sceneId, 'dolly-in', scene.camera.strength ?? 0.5);
  }
  return out;
}

/** A panel in the accent colour that sweeps across the frame, left to right: in over the last frames of a shot, out over the first frames of the next. */
function wipeLayer(sceneId: string, w: number, h: number, frames: number, colour: string, half: 'out' | 'in'): Obj {
  const pw = w * 1.15;
  const from = half === 'out' ? -pw / 2 : w / 2;
  const to = half === 'out' ? w / 2 : w + pw / 2;
  const t0 = half === 'out' ? Math.max(0, frames - WIPE_FRAMES) : 0;
  return {
    kind: 'shape',
    id: `${PREFIX}${sceneId}:wipe-${half}`,
    name: `wipe ${half}`,
    inPoint: t0,
    outPoint: half === 'out' ? frames : Math.min(frames, WIPE_FRAMES + 1),
    path: { kind: 'rect', size: [pw, h * 1.1] },
    fill: colour,
    transform: {
      position: [
        { t: t0, v: [from, h / 2], easeOut: half === 'out' ? [0.55, 0, 1, 0.45] : [0, 0.55, 0.45, 1] },
        { t: t0 + WIPE_FRAMES, v: [to, h / 2] },
      ],
      anchor: [pw / 2, (h * 1.1) / 2],
      scale: [1, 1],
      rotation: 0,
      opacity: 1,
    },
  };
}

const isFinish = (l: Obj): boolean => typeof l.id === 'string' && l.id.startsWith(PREFIX);

const SHADOW = { name: 'drop-shadow', params: { distance: 26, direction: 180, softness: 30, opacity: 0.5, color: '#1a0f08' } };

/** Type that reads like an ad: heavier headline, tracked caption, the price punched up. */
function dressText(l: Obj): void {
  const s = l.style as Obj | undefined;
  if (!s) return;
  const price = typeof l.source === 'string' && /^[$€£]\s?\d/.test(l.source);
  if (price) {
    s.weight = 800;
    s.size = Math.max(s.size ?? 0, 168);
    s.font = 'Georgia, "Times New Roman", serif';
  } else if (l.id.endsWith(':caption')) {
    s.weight = 600;
    s.size = Math.max(s.size ?? 0, 52);
    s.letterSpacing = 6;
  } else {
    s.weight = Math.max(Number(s.weight ?? 0), 700);
  }
  l.effects = [{ name: 'drop-shadow', params: { distance: 4, direction: 180, softness: 8, opacity: 0.35, color: '#000000' } }];
}


const PRICE_RE = /(?:[$€£]\s?\d{1,6}(?:[.,]\d{1,2})?|\d{1,6}(?:[.,]\d{1,2})?\s?(?:USD|EUR|GBP|CAD|AUD))/;

/** The first price a piece of text names ("$4.50", "19 EUR"), as written. */
export function findPrice(text: string): string | undefined {
  return text.match(PRICE_RE)?.[0].trim();
}

const textLayers = (c: Comp): Obj[] => Object.values((c.precomps ?? {}) as Record<string, Obj>).flatMap((p) => (p.layers as Obj[]).filter((l) => l.kind === 'text'));

/** A price the brief names but no text layer shows is put on the last scene, so an ad never ships without its price. */
export function ensurePrice(c: Comp, brief: string | undefined): Comp {
  const price = brief ? findPrice(brief) : undefined;
  const amount = price ? parsePrice(price) : undefined;
  if (!price || amount === undefined) return c;
  if (textLayers(c).some((l) => typeof l.source === 'string' && parsePrice(l.source.replace(/\n/g, ' ')) === amount && PRICE_RE.test(l.source))) return c;
  const scenes = Object.entries(((c.meta?.director as Obj | undefined)?.scenes ?? {}) as Record<string, { startFrame: number }>);
  const last = scenes.sort((a, b) => b[1].startFrame - a[1].startFrame)[0]?.[0];
  if (!last) return c;
  const fill = (textLayers(c).find((l) => l.style?.fill)?.style.fill as string | undefined) ?? '#1a1a1a';
  return addLayer(c, { sceneId: last, role: 'caption', kind: 'text', text: price, style: { size: 168, weight: 800, color: fill, align: 'center' } });
}

/** Breaks a static text layer into lines that fit the frame. The engine only wraps at `boxWidth` for animated text, so the breaks are written into the source; a single word wider than the frame shrinks the type instead. */
export function fitText(l: Obj, frameW: number): void {
  const s = l.style as Obj | undefined;
  if (!s || typeof l.source !== 'string' || typeof s.size !== 'number') return;
  const sc = l.transform?.scale;
  const k = Array.isArray(sc) && typeof sc[0] === 'number' ? Math.abs(sc[0]) : Array.isArray(sc) ? Math.max(...sc.map((f: { v: number[] }) => Math.abs(f.v?.[0] ?? 1))) : 1;
  const maxW = frameW * 0.88;
  const perChar = () => s.size * k * (Number(s.weight ?? 400) >= 700 ? 0.6 : 0.55);
  const width = (t: string) => t.length * perChar();
  const words = l.source.split(/\s+/).filter(Boolean);
  const longest = Math.max(0, ...words.map((w: string) => w.length));
  if (longest * perChar() > maxW) s.size = Math.floor(maxW / (longest * (perChar() / s.size)));
  const lines: string[] = [];
  for (const para of l.source.split('\n')) {
    let cur = '';
    for (const w of para.split(/\s+/).filter(Boolean)) {
      if (cur && width(`${cur} ${w}`) > maxW) { lines.push(cur); cur = w; } else cur = cur ? `${cur} ${w}` : w;
    }
    lines.push(cur);
  }
  l.source = lines.join('\n');
  if (lines.length > 1 && s.align === undefined) s.align = 'center';
}

function gradeLayer(sceneId: string, w: number, h: number, frames: number, colour: string): Obj {
  return {
    kind: 'shape',
    id: `${PREFIX}${sceneId}:grade`,
    name: 'grade',
    inPoint: 0,
    outPoint: frames,
    path: { kind: 'rect', size: [w, h] },
    fill: colour,
    blendMode: 'soft-light',
    transform: { position: [w / 2, h / 2], anchor: [w / 2, h / 2], scale: [1, 1], rotation: 0, opacity: 0.16 },
  };
}

/** A white flash on the first frames of a shot, so each cut lands like a beat. */
function flashLayer(sceneId: string, w: number, h: number, frames: number): Obj {
  return {
    kind: 'shape',
    id: `${PREFIX}${sceneId}:flash`,
    name: 'flash',
    inPoint: 0,
    outPoint: frames,
    path: { kind: 'rect', size: [w, h] },
    fill: '#fff3de',
    blendMode: 'screen',
    transform: {
      position: [w / 2, h / 2],
      anchor: [w / 2, h / 2],
      scale: [1, 1],
      rotation: 0,
      opacity: [
        { t: 0, v: 0.35, easeOut: [0, 0, 0.58, 1] },
        { t: 8, v: 0 },
      ],
    },
  };
}

export function finishComposition(c: Comp, o: FinishOptions = {}): Comp {
  // a second finish redraws the badges an earlier one drew, though the copy no longer names their price
  const prior = priorBadges(c);
  let out = ensurePrice(structuredClone(c), o.brief);
  const director = (out.meta?.director ?? {}) as Obj;
  const roles = (director.layers ?? {}) as Record<string, { role?: string }>;
  const colour = o.grade ?? '#ffb870';

  for (const [pid, p] of Object.entries((out.precomps ?? {}) as Record<string, Obj>)) {
    const layers: Obj[] = (p.layers as Obj[]).filter((l) => !isFinish(l));
    for (const l of layers) {
      if (l.kind === 'image' && roles[l.id]?.role === 'product') l.effects = [structuredClone(SHADOW)];
      if (l.kind === 'text') {
        dressText(l);
        fitText(l, p.width);
      }
    }
    // the grade and the flash sit under the type, over the photography
    const at = layers.findIndex((l) => l.kind === 'text');
    const extra = [gradeLayer(pid, p.width, p.height, p.durationInFrames, colour), flashLayer(pid, p.width, p.height, p.durationInFrames)];
    layers.splice(at < 0 ? layers.length : at, 0, ...extra);
    p.layers = layers;
  }

  // the wrapped type may now collide, and a static shot is a still: settle both before the cuts are laid on top
  out = pushStaticShots(separateText(out).comp);
  out = priceBadges(out, { prior, refit: fitText, ...(o.accent ? { accent: o.accent } : {}) });
  const order = Object.values(readDirector(out).scenes)
    .filter((s) => (out.precomps as Record<string, Obj>)[s.precompId])
    .sort((a, b) => a.startFrame - b.startFrame);
  order.forEach((s, i) => {
    const p = (out.precomps as Record<string, Obj>)[s.precompId]!;
    // the wipe is the top layer: it covers the type too, so the whole frame cuts
    if (i < order.length - 1) (p.layers as Obj[]).push(wipeLayer(s.precompId, p.width, p.height, p.durationInFrames, o.accent ?? '#ffffff', 'out'));
    if (i > 0) (p.layers as Obj[]).push(wipeLayer(s.precompId, p.width, p.height, p.durationInFrames, o.accent ?? '#ffffff', 'in'));
  });

  const top = (out.layers as Obj[]).filter((l) => !isFinish(l));
  if (o.musicAssetId) {
    top.unshift({
      kind: 'audio',
      id: `${PREFIX}music`,
      name: 'music',
      inPoint: 0,
      outPoint: out.durationInFrames,
      assetId: o.musicAssetId,
      level: o.musicLevel ?? 0.7,
      transform: { position: [0, 0], anchor: [0, 0], scale: [1, 1], rotation: 0, opacity: 1 },
    });
  }
  out.layers = top as Comp['layers'];
  return out;
}
