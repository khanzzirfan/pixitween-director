import sharp from 'sharp';
import { LIGHT, VOCAB } from './cinematic-rules';
import { shade } from './retail-clip';
import { tint } from './variant-film';

// The set of a cinematic film: what stands far behind the product (a backdrop picture on the stage's wall), the floor under it, and the air
// in front of it. Muse names the look and the air; the pictures here are drawn by code from a recipe and the film's light, so a set costs
// nothing and is the same every time. The wall sits 3 m behind the product and the camera moves, so the engine's perspective gives the
// parallax: near things slide faster than far ones.

export const SET_LOOKS = ['beach', 'pool', 'sunset', 'sky', 'studio', 'night', 'garden'] as const;
/** none: clear air. dust: fine specks drifting round the product. bokeh: big soft lights drifting near the lens. spray: a burst of droplets in the peak shot. smoke: slow smoke drifting up behind the product the whole film. */
export const SET_AIR = ['none', 'dust', 'bokeh', 'spray', 'smoke'] as const;
export type SetLook = (typeof SET_LOOKS)[number];
export type SetAir = (typeof SET_AIR)[number];

/**
 * What fills the sky of the backdrop besides its colours. none: a clean gradient. clouds: soft pale blobs. spots: warm out-of-focus lights
 * (a city, a party). rays: light fanning down from the glow. bands: wide soft horizontal bands (haze, dusk, fabric). grid: a faint perspective grid (tech, retro).
 */
export const SET_TEXTURES = ['none', 'clouds', 'spots', 'rays', 'bands', 'grid'] as const;
export type SetTexture = (typeof SET_TEXTURES)[number];

/**
 * The world as Muse paints it: any of these laid over the look's own recipe (the look is only a starting point). Colours are #rrggbb. glow is
 * a light in the sky (a sun, a lamp, a moon): where it sits across and down the picture (0 to 1; the camera sees the low part, so use 0.5 to 1 down),
 * how big (0.1 small to 0.6 huge) and its colour. band is a strip along the horizon (a sea, a city, hills).
 */
export interface SetPalette {
  top?: string;
  horizon?: string;
  ground?: string;
  glow?: { x: number; y: number; color: string; size: number };
  band?: { color: string; height: number; foam?: boolean };
  stars?: boolean;
  texture?: SetTexture;
  /** the colour of the texture's shapes: the clouds, the lights, the rays */
  accent?: string;
}

export interface BoardSet {
  look: SetLook;
  air: SetAir;
  /** Muse's own colours and light over the look's recipe. */
  palette?: SetPalette;
}

/** One line per look, for Muse's prompt (the rule book's words). */
export const SET_HELP: Record<SetLook, string> = VOCAB.looks;

type Tone = 'warm' | 'cool' | 'neutral';
type Key = 'low' | 'mid' | 'high';

interface Recipe {
  /** sky colours: the zenith and the horizon (the picture's bottom edge, which meets the floor) */
  top: string;
  horizon: string;
  /** a band along the horizon (the sea), if any, as a share of the picture's height */
  band?: { color: string; foam: boolean; height: number };
  /** the floor in front of the wall, in 3D */
  ground: string;
  /** a glow (the sun) */
  glow?: { x: number; y: number; color: string; r: number };
  /** soft blobs, as [x, y, r, color, opacity] shares of the picture */
  blobs?: Array<[number, number, number, string, number]>;
  stars?: boolean;
  /** the pattern Muse chose for the sky, and its colour */
  texture?: SetTexture;
  textureColor?: string;
}

// The picture's bottom edge is the horizon and the wall is 4 m high, so the camera (a few cm to 30 cm up) sees mostly the lowest third of it:
// what should be seen in the ordinary shots (the sun, the clouds, the sea) sits in that third, y from 0.55 to 1.
const RECIPES: Record<SetLook, Recipe> = {
  beach: {
    top: '#2f8fe0', horizon: '#9fd6f5', band: { color: '#1b95d1', foam: true, height: 0.09 }, ground: '#d2ad6c',
    glow: { x: 0.72, y: 0.66, color: '#fff3c4', r: 0.3 },
    blobs: [[0.18, 0.62, 0.07, '#ffffff', 0.6], [0.42, 0.7, 0.05, '#ffffff', 0.5], [0.9, 0.5, 0.08, '#ffffff', 0.5]],
  },
  pool: {
    top: '#3cc0dc', horizon: '#7fe6f2', ground: '#43bfd8',
    blobs: [[0.2, 0.7, 0.1, '#d6fcff', 0.55], [0.55, 0.82, 0.12, '#b4f3ff', 0.5], [0.8, 0.62, 0.09, '#ffffff', 0.45], [0.38, 0.55, 0.08, '#e6feff', 0.4]],
  },
  sunset: {
    top: '#2d2468', horizon: '#ff9a5c', ground: '#33203d',
    glow: { x: 0.5, y: 0.86, color: '#ffd27a', r: 0.34 },
    blobs: [[0.2, 0.7, 0.07, '#ff6f91', 0.4], [0.82, 0.6, 0.06, '#ffb36b', 0.4]],
  },
  sky: {
    top: '#2c84e6', horizon: '#cfe9ff', ground: '#eaf4ff',
    blobs: [[0.2, 0.7, 0.09, '#ffffff', 0.75], [0.7, 0.6, 0.1, '#ffffff', 0.7], [0.5, 0.84, 0.09, '#ffffff', 0.7]],
  },
  studio: { top: '#c9c9d0', horizon: '#b9b9c0', ground: '#b9b9c0' },
  night: { top: '#040818', horizon: '#1a2b60', ground: '#050a18', stars: true },
  garden: {
    top: '#7fc467', horizon: '#9bd47e', ground: '#4a8c3b',
    blobs: [[0.12, 0.7, 0.09, '#d6f5a8', 0.55], [0.5, 0.6, 0.1, '#8bd06c', 0.55], [0.85, 0.75, 0.08, '#e9ffbf', 0.5], [0.3, 0.88, 0.07, '#3f8f3a', 0.5]],
  },
};

/** The look's recipe with Muse's palette laid over it: every colour Muse wrote replaces the look's, the rest stays. */
function recipeOf(look: SetLook, palette?: SetPalette): Recipe {
  const base = RECIPES[look];
  if (!palette) return base;
  const out: Recipe = { ...base };
  if (palette.top) out.top = palette.top;
  if (palette.horizon) out.horizon = palette.horizon;
  if (palette.ground) out.ground = palette.ground;
  if (palette.glow) out.glow = { x: palette.glow.x, y: palette.glow.y, color: palette.glow.color, r: palette.glow.size };
  if (palette.band) out.band = { color: palette.band.color, foam: palette.band.foam ?? false, height: palette.band.height };
  if (palette.stars !== undefined) out.stars = palette.stars;
  // a texture Muse names replaces the look's own shapes (the look's clouds, say); `clouds` keeps them, tinted by the accent
  if (palette.texture) {
    out.blobs = palette.texture === 'clouds' ? (base.blobs ?? DEFAULT_CLOUDS).map(([x, y, rad, color, op]) => [x, y, rad, palette.accent ?? color, op]) : undefined;
    out.texture = palette.texture;
    if (palette.accent) out.textureColor = palette.accent;
  }
  return out;
}
const DEFAULT_CLOUDS: Array<[number, number, number, string, number]> = [[0.2, 0.7, 0.09, '#ffffff', 0.6], [0.7, 0.6, 0.1, '#ffffff', 0.55], [0.5, 0.84, 0.09, '#ffffff', 0.55]];

/** A look's colours moved by the film's light: a low key is dark, a warm tone leans toward amber and a cool one toward blue. A high key is left to the world's exposure: the set was tuned at it, and brightening it here washes the beach out. */
function lit(hex: string, tone: Tone | undefined, key: Key | undefined): string {
  let c = hex;
  if (key === 'low') c = shade(c, 0.4);
  if (tone === 'warm') c = tint(shade(c, 0.05), 0.04);
  if (tone === 'cool') c = mix(c, '#5a8fd8', 0.08);
  return c;
}

/** `a` moved `f` of the way toward `b`, channel by channel. */
function mix(a: string, b: string, f: number): string {
  const ch = (hex: string, s: number) => parseInt(hex.slice(1 + s, 3 + s), 16);
  const out = [0, 2, 4].map((s) => Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * f).toString(16).padStart(2, '0'));
  return `#${out.join('')}`;
}

/** The colour of the floor under the product for a look and the film's light. */
export function groundColor(look: SetLook, tone?: Tone, key?: Key, palette?: SetPalette): string {
  return lit(recipeOf(look, palette).ground, tone, key);
}

const hash = (n: number) => (Math.imul(n + 1, 2654435761) >>> 0) / 4294967296;

/** The wall the backdrop is drawn on: 4 m high, 3.2 m behind the product. Its width follows the picture. */
export const WALL = { distance: 3.2, height: 4 } as const;

/**
 * The backdrop picture: a sky from the zenith down to the horizon at its bottom edge, a sea band, soft blobs, a glow, stars. `ratio` is the width
 * over the height of the frame it stands behind; the picture is made wider than the frame (2.2 times) so a camera that swings round, or a lens
 * that widens, never sees its edge.
 */
export async function renderBackdrop(o: { look: SetLook; ratio: number; tone?: Tone; key?: Key; palette?: SetPalette }): Promise<{ png: Buffer; width: number; height: number }> {
  const r = recipeOf(o.look, o.palette);
  const H = 1024;
  const W = Math.min(2400, Math.max(768, Math.round(H * o.ratio * 2.2)));
  const c = (hex: string) => lit(hex, o.tone, o.key);
  const band = r.band ? Math.round(H * r.band.height) : 0;
  const parts: string[] = [];
  parts.push(`<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c(r.top)}"/><stop offset="1" stop-color="${c(r.horizon)}"/></linearGradient>`);
  if (r.glow) parts.push(`<radialGradient id="glow"><stop offset="0" stop-color="${c(r.glow.color)}" stop-opacity="0.95"/><stop offset="1" stop-color="${c(r.glow.color)}" stop-opacity="0"/></radialGradient>`);
  parts.push('</defs>');
  parts.push(`<rect width="${W}" height="${H}" fill="url(#sky)"/>`);
  if (r.glow) parts.push(`<circle cx="${Math.round(W * r.glow.x)}" cy="${Math.round(H * r.glow.y)}" r="${Math.round(H * r.glow.r)}" fill="url(#glow)"/>`);
  for (const [x, y, rad, color, op] of r.blobs ?? []) {
    parts.push(`<ellipse cx="${Math.round(W * x)}" cy="${Math.round(H * y)}" rx="${Math.round(H * rad * 2.4)}" ry="${Math.round(H * rad)}" fill="${c(color)}" fill-opacity="${op}"/>`);
  }
  if (r.texture && r.texture !== 'none' && r.texture !== 'clouds') parts.push(...textureShapes(r.texture, r.textureColor ?? r.glow?.color ?? '#ffffff', W, H, r.glow, c));
  if (r.band) {
    parts.push(`<linearGradient id="sea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c(tint(r.band.color, 0.3))}"/><stop offset="1" stop-color="${c(shade(r.band.color, 0.25))}"/></linearGradient>`);
    parts.push(`<rect y="${H - band}" width="${W}" height="${band}" fill="url(#sea)"/>`);
    if (r.band.foam) parts.push(`<rect y="${H - band - 4}" width="${W}" height="8" fill="#ffffff" fill-opacity="0.85"/>`);
  }
  if (r.stars) {
    for (let i = 0; i < 160; i++) {
      const x = Math.round(hash(i * 3) * W);
      const y = Math.round((0.35 + hash(i * 3 + 1) * 0.6) * H);
      parts.push(`<circle cx="${x}" cy="${y}" r="${(1.5 + hash(i * 3 + 2) * 2.5).toFixed(1)}" fill="#fff" fill-opacity="${(0.4 + hash(i) * 0.6).toFixed(2)}"/>`);
    }
  }
  // the corners darken, so the eye stays on the centre, where the product is
  parts.push(`<defs><radialGradient id="vig" cx="0.5" cy="0.6" r="0.75"><stop offset="0.55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="${LIGHT[o.key ?? 'mid'].vignette}"/></radialGradient></defs><rect width="${W}" height="${H}" fill="url(#vig)"/>`);
  // soften the picture: it is far away, and hard edges would flicker under the lens blur
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join('')}</svg>`;
  const png = await sharp(Buffer.from(svg)).blur(1.5).png().toBuffer();
  return { png, width: W, height: H };
}

/**
 * The shapes of a named texture, as SVG: warm lights, rays fanning from the glow, wide soft bands, or a faint perspective grid. All are
 * closed-form from the picture's size (and a hash for the lights), so a backdrop is the same every time.
 */
function textureShapes(kind: SetTexture, color: string, W: number, H: number, glow: Recipe['glow'], c: (hex: string) => string): string[] {
  const out: string[] = [];
  const col = c(color);
  if (kind === 'spots') {
    for (let i = 0; i < 42; i++) {
      const x = Math.round(hash(i * 5) * W);
      const y = Math.round((0.45 + hash(i * 5 + 1) * 0.5) * H);
      const rad = Math.round(H * (0.012 + hash(i * 5 + 2) * 0.03));
      out.push(`<circle cx="${x}" cy="${y}" r="${rad}" fill="${col}" fill-opacity="${(0.18 + hash(i * 5 + 3) * 0.4).toFixed(2)}"/>`);
    }
  } else if (kind === 'rays') {
    const cx = Math.round(W * (glow?.x ?? 0.5));
    const cy = Math.round(H * (glow?.y ?? 0.8));
    for (let i = 0; i < 14; i++) {
      const a = (-Math.PI * (0.15 + 0.7 * (i / 13))) + (hash(i) - 0.5) * 0.12;
      const len = H * 2.2;
      const w = 0.035 + hash(i + 40) * 0.05;
      const p = (ang: number) => `${Math.round(cx + Math.cos(ang) * len)},${Math.round(cy + Math.sin(ang) * len)}`;
      out.push(`<polygon points="${cx},${cy} ${p(a - w)} ${p(a + w)}" fill="${col}" fill-opacity="${(0.07 + hash(i + 7) * 0.09).toFixed(2)}"/>`);
    }
  } else if (kind === 'bands') {
    for (let i = 0; i < 7; i++) {
      const y = Math.round(H * (0.4 + i * 0.08));
      out.push(`<rect y="${y}" width="${W}" height="${Math.round(H * (0.025 + hash(i) * 0.03))}" fill="${col}" fill-opacity="${(0.1 + hash(i + 9) * 0.14).toFixed(2)}"/>`);
    }
  } else if (kind === 'grid') {
    for (let i = 1; i <= 10; i++) out.push(`<line x1="0" x2="${W}" y1="${Math.round(H - H * 0.38 * (1 - i / 11) ** 2 - 2)}" y2="${Math.round(H - H * 0.38 * (1 - i / 11) ** 2 - 2)}" stroke="${col}" stroke-opacity="0.35" stroke-width="2"/>`);
    for (let i = -14; i <= 14; i++) out.push(`<line x1="${Math.round(W / 2 + i * W * 0.012)}" y1="${Math.round(H * 0.62)}" x2="${Math.round(W / 2 + i * W * 0.1)}" y2="${H}" stroke="${col}" stroke-opacity="0.28" stroke-width="2"/>`);
  }
  return out;
}

/** The soft dot of light a bokeh card is drawn with, in the key light's colour. */
export async function renderDot(color = '#ffffff'): Promise<{ png: Buffer; width: number; height: number }> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><defs><radialGradient id="d"><stop offset="0" stop-color="${color}" stop-opacity="1"/><stop offset="0.6" stop-color="${color}" stop-opacity="0.85"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient></defs><circle cx="64" cy="64" r="64" fill="url(#d)"/></svg>`;
  return { png: await sharp(Buffer.from(svg)).png().toBuffer(), width: 128, height: 128 };
}
