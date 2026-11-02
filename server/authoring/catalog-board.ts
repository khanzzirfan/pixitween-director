import type { Buffer } from 'node:buffer';
import { z } from 'zod';
import type { ToolCtx } from '@shared/tools';
import { CRAFT } from './reference-deck';

// The catalog board: what one product's hero film is made of, for any product shape (a surfboard, a towel, a can), played in 2D
// by board-clip.ts with the real cut-out. Muse looks at the product photo and writes the idea, the words on screen and the shot
// list (docs/direction/corpus/01-ad-laws.md, 04-motion-and-edit.md, 06-reference-films.md); a checker holds the shots to what the
// reference films do, and a floor board stands in when Muse is not asked or fails twice. Pure except planCatalogBoard (one Spark
// vision call, about $0.005).

export const CB_SIZES = ['wide', 'medium', 'close', 'macro'] as const;
/** push: in, pull: out (the payoff), hold: almost still, sway: an in-plane tilt back and forth, dolly-zoom: the world grows while the product holds its size. */
export const CB_MOVES = ['push', 'pull', 'hold', 'sway', 'dolly-zoom'] as const;
/** How the product arrives in the shot: it is already there, drops in from above, tumbles in tilted, or slides in from the side. */
export const CB_ENTRANCES = ['none', 'drop', 'tumble', 'slide'] as const;
/** How the shot starts: a hard cut, a whip (the shot slams in sideways) or a flash (a burst of light fades off it). */
export const CB_CUTS = ['hard', 'whip', 'flash'] as const;
/** The world behind the product: a colour field, the field with a breathing halo, or the painted plate of the product's look. */
export const CB_WORLDS = ['field', 'halo', 'plate'] as const;
/** What floats in the air of the shot. */
export const CB_AIR = ['none', 'confetti', 'bokeh', 'dust'] as const;
export const CB_PHASES = ['hook', 'build', 'peak', 'reveal', 'close'] as const;
export const CB_TONES = ['warm', 'cool', 'neutral'] as const;
export const CB_KEYS = ['low', 'mid', 'high'] as const;

export type CbSize = (typeof CB_SIZES)[number];
export type CbMove = (typeof CB_MOVES)[number];
export type CbEntrance = (typeof CB_ENTRANCES)[number];
export type CbCut = (typeof CB_CUTS)[number];
export type CbWorld = (typeof CB_WORLDS)[number];
export type CbAir = (typeof CB_AIR)[number];
export type CbPhase = (typeof CB_PHASES)[number];

const shotSchema = z.object({
  size: z.enum(CB_SIZES),
  move: z.enum(CB_MOVES),
  seconds: z.number().positive().max(6),
  phase: z.enum(CB_PHASES).catch('build'),
  entrance: z.enum(CB_ENTRANCES).catch('none'),
  cut: z.enum(CB_CUTS).catch('hard'),
  world: z.enum(CB_WORLDS).catch('field'),
  air: z.enum(CB_AIR).catch('none'),
  /** Words on screen in this shot, at most five; never in the last shot (the price lands there). */
  text: z.string().max(40).optional(),
  note: z.string().max(160).optional(),
});
export type CbShot = z.infer<typeof shotSchema>;

export const catalogBoardSchema = z.object({
  concept: z.string().max(240).catch(''),
  mood: z.string().max(80).catch(''),
  tone: z.enum(CB_TONES).catch('neutral'),
  key: z.enum(CB_KEYS).catch('mid'),
  /** The end card's line, typed word by word; the last word is set bold. */
  tagline: z.string().min(1).max(48),
  shots: z.array(shotSchema).min(1).max(12),
});
export type CatalogBoard = z.infer<typeof catalogBoardSchema>;

/** The reference-film rules a board is held to (06-reference-films.md): hook in the first second, fast middle, a long last hold. */
export const CB_RULES = { minShots: 5, maxShots: 9, minTotal: 6, maxTotal: 11, firstMax: 1.5, minShot: 0.4, maxShot: 2.5, holdMin: 0.12, holdMax: 0.37, maxWords: 5 } as const;

const total = (b: CatalogBoard) => Math.round(b.shots.reduce((s, x) => s + x.seconds, 0) * 100) / 100;

/** Every way the board breaks the rules, as sentences Muse can act on; empty when it passes. */
export function checkCatalogBoard(b: CatalogBoard): string[] {
  const R = CB_RULES;
  const out: string[] = [];
  const n = b.shots.length;
  const T = total(b);
  if (n < R.minShots || n > R.maxShots) out.push(`use ${R.minShots} to ${R.maxShots} shots (you have ${n})`);
  if (T < R.minTotal || T > R.maxTotal) out.push(`make the film ${R.minTotal}-${R.maxTotal} s long (it is ${T} s)`);
  if (!n) return out;
  const first = b.shots[0]!;
  const last = b.shots[n - 1]!;
  if (first.seconds > R.firstMax) out.push(`the first shot is the hook: at most ${R.firstMax} s`);
  if (first.phase !== 'hook') out.push('the first shot is the hook (phase "hook")');
  if (last.phase !== 'close') out.push('the last shot is the close (phase "close")');
  if (last.move !== 'hold' && last.move !== 'push') out.push('the last shot holds (move "hold" or a slow "push") so the price can be read');
  if (last.text) out.push('the last shot carries no text: the price, the name and the tagline land there');
  const share = T ? last.seconds / T : 0;
  if (share < R.holdMin || share > R.holdMax) out.push(`the last shot holds ${R.holdMin * 100}-${R.holdMax * 100}% of the film (it is ${Math.round(share * 100)}%)`);
  b.shots.slice(0, -1).forEach((s, i) => {
    if (s.seconds < R.minShot || s.seconds > R.maxShot) out.push(`shot ${i + 1} lasts ${s.seconds} s; every shot but the last lasts ${R.minShot}-${R.maxShot} s`);
  });
  b.shots.forEach((s, i) => {
    if (s.text && s.text.trim().split(/\s+/).length > R.maxWords) out.push(`shot ${i + 1}: at most ${R.maxWords} words on screen`);
    const prev = b.shots[i - 1];
    if (prev && prev.size === s.size && prev.move === s.move) out.push(`shots ${i} and ${i + 1} have the same size and move; change one (no slideshow)`);
    const prev2 = b.shots[i - 2];
    if (prev && prev2 && prev.size === s.size && prev2.size === s.size) out.push(`shots ${i - 1} to ${i + 1} are all ${s.size}; never three of one size in a row`);
  });
  if (!b.shots.some((s) => s.size === 'macro')) out.push('include one macro shot (the product fills the frame)');
  if (!b.shots.some((s) => s.size === 'wide')) out.push('include one wide shot (the product small in its world)');
  const peaks = b.shots.map((s, i) => ({ s, i })).filter((x) => x.s.phase === 'peak');
  if (peaks.length !== 1) out.push('exactly one shot is the peak');
  else {
    const at = b.shots.slice(0, peaks[0]!.i).reduce((a, x) => a + x.seconds, 0) / (T || 1);
    if (at < 0.35 || at > 0.8) out.push('the peak starts at 35-80% of the film');
  }
  if (b.shots.filter((s) => s.move === 'dolly-zoom').length > 1) out.push('use the dolly-zoom once at most');
  if (b.shots.filter((s) => s.cut !== 'hard').length > 3) out.push('use whip or flash cuts on at most three shots');
  const pushes = b.shots.filter((s) => s.move === 'push').length;
  if (pushes < Math.ceil(n * 0.3)) out.push('push in on at least a third of the shots (push-in is the default move)');
  if (b.tagline.trim().split(/\s+/).length > 6) out.push('the tagline is at most six words');
  return out;
}

/** Reads a Spark reply (an object or JSON text) as a board, or says why it could not. */
export function parseCatalogBoard(raw: unknown): { ok: true; board: CatalogBoard } | { ok: false; reason: string } {
  let data: unknown = raw;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ''));
    } catch {
      return { ok: false, reason: 'not JSON' };
    }
  }
  if (data === null || typeof data !== 'object') return { ok: false, reason: 'empty reply' };
  const strip = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(strip) : v !== null && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null).map(([k, x]) => [k, strip(x)])) : v;
  const r = catalogBoardSchema.safeParse(strip(data));
  if (!r.success) return { ok: false, reason: r.error.issues[0]?.message ?? 'wrong shape' };
  return { ok: true, board: { ...r.data, shots: r.data.shots.map((s) => ({ ...s, seconds: Math.round(s.seconds * 100) / 100 })) } };
}

/** What a product is, for the prompt and the floor board. */
export interface BoardProduct {
  title: string;
  brand?: string;
  category: string;
  price: number;
  salePrice?: number;
  currency?: string;
}

/** The prompt that asks Muse, looking at the product photo, for a board. `violations` and `previous` are set on the retry. */
export function catalogBoardPrompt(p: BoardProduct, o: { hasPlate: boolean; violations?: string[]; previous?: CatalogBoard } = { hasPlate: false }): { system: string; user: string } {
  const R = CB_RULES;
  return {
    system: [
      'You are the creative director of a short vertical product ad for a shop catalogue. The real product photo is cut out and composited over a world drawn with layers: colour fields, a soft halo, light, floating particles, words. You direct the camera, the edit and the words; you never draw the product.',
      'HOW THE BEST ADS ARE CUT (measured on eight real 9:16 product ads; take the craft, not the things):',
      `- ${CRAFT}`,
      'YOUR TASK. Look at the photo. Find the ONE idea of this product (a feeling, a contrast, a moment it belongs to) and write it as the concept. Then write the shot list that tells it, every shot with a reason (the note). Reply with JSON only, in this shape:',
      '{"concept":"one sentence","mood":"a few words","tone":"warm|cool|neutral","key":"low|mid|high","tagline":"at most six words","shots":[{"size","move","seconds","phase","entrance","cut","world","air","text","note"}]}',
      `size: ${CB_SIZES.join(', ')} (wide = the product small in a big world; macro = the product fills the frame, a detail close-up).`,
      `move: ${CB_MOVES.join(', ')} (push in is the default; pull out is the payoff, once; sway tilts the product gently; dolly-zoom grows the world while the product holds its size, once, late, as the reveal).`,
      `entrance: ${CB_ENTRANCES.join(', ')} (how the product arrives: use drop or tumble on the hook, slide or tumble once or twice more, none when the shot continues).`,
      `cut: ${CB_CUTS.join(', ')} (how the shot starts: whip slams it in sideways, flash fades a burst of light off it; use them where the world changes, two or three in the film).`,
      `world: ${CB_WORLDS.join(', ')}${o.hasPlate ? ' (plate is a painted scene for this product: use it for one to three shots, the wide and the close)' : ' (there is no painted plate for this product: use field and halo only)'}; change the world every shot or two.`,
      `air: ${CB_AIR.join(', ')} (confetti for a sale or a celebration, bokeh for night or sparkle, dust for warm sunlight; none in the macro and the close).`,
      'text: the words on screen in that shot, at most five, written like an ad: a hook line on the first shot, one benefit or feeling in the middle, never the price or the product name (they land on the last shot by themselves). Most shots have no text. Never in the last shot.',
      `tone (key light colour) and key (low = dark world, one bright product; high = bright and airy) come from the idea and the photo's colours.`,
      `phase: ${CB_PHASES.join(', ')}. Rules: ${R.minShots}-${R.maxShots} shots, ${R.minTotal}-${R.maxTotal} s in all. The first shot is the hook (at most ${R.firstMax} s, already moving). Every shot but the last lasts ${R.minShot}-${R.maxShot} s and the cut rate speeds up through the middle. Exactly one peak at 35-80% of the film. The last shot is the close: move hold or a slow push, ${R.holdMin * 100}-${R.holdMax * 100}% of the film, no text, no air. Include one wide and one macro. Two shots in a row differ in size or move; never three of one size in a row. Push in on at least a third of the shots.`,
      'tagline: the end-card line for THIS product and its idea, at most six words, no price, no brand name; its last word is the strong one.',
      'Never name a real brand, a real person or a place you cannot see; the brand on screen is the shop\'s own.',
    ].join('\n'),
    user: [
      `Product: ${p.title}${p.brand ? ` by ${p.brand}` : ''} (${p.category}).`,
      p.salePrice !== undefined ? `It is on sale: ${p.salePrice} ${p.currency ?? 'USD'}, was ${p.price}.` : `Price: ${p.price} ${p.currency ?? 'USD'}.`,
      ...(o.violations?.length ? ['Your last board broke these rules; fix them and keep everything else about it:', ...o.violations.map((x) => `- ${x}`)] : []),
      ...(o.previous && o.violations?.length ? ['Your last board:', JSON.stringify(o.previous)] : []),
    ].join('\n'),
  };
}

/** A small stable hash of a string, so the floor board picks the same template for the same product every time. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * The floor boards: three shot lists that pass the checker, written from the reference films, so a catalogue without Muse still
 * gets cut films that differ from product to product. The words come from the product's own title and category.
 */
export function floorCatalogBoard(p: BoardProduct, o: { hasPlate: boolean } = { hasPlate: false }): CatalogBoard {
  const sale = p.salePrice !== undefined;
  const wide: CbWorld = o.hasPlate ? 'plate' : 'halo';
  const word = (p.category.split(/\s+/)[0] ?? 'new').toLowerCase();
  const templates: CatalogBoard[] = [
    {
      concept: `${p.title}: small in a big world, then up close, then the hero`,
      mood: 'bright, quick, clean',
      tone: 'neutral',
      key: 'mid',
      tagline: sale ? 'Grab it while it lasts' : `Made for your ${word} days`,
      shots: [
        { size: 'wide', move: 'push', seconds: 1.0, phase: 'hook', entrance: 'drop', cut: 'hard', world: wide, air: sale ? 'confetti' : 'dust', text: sale ? 'Sale on now' : 'Meet your new favourite', note: 'hook: it drops into a big world and we dive in' },
        { size: 'macro', move: 'push', seconds: 0.7, phase: 'build', entrance: 'none', cut: 'flash', world: 'field', air: 'none', note: 'the detail fills the frame' },
        { size: 'medium', move: 'sway', seconds: 1.1, phase: 'build', entrance: 'tumble', cut: 'whip', world: 'halo', air: 'bokeh', text: 'Built to last', note: 'it tumbles in and sways under the halo' },
        { size: 'close', move: 'push', seconds: 0.8, phase: 'peak', entrance: 'none', cut: 'hard', world: 'field', air: 'dust', note: 'the peak: close and pushing' },
        { size: 'wide', move: 'pull', seconds: 1.0, phase: 'reveal', entrance: 'none', cut: 'hard', world: wide, air: 'none', note: 'pull back: the payoff' },
        { size: 'medium', move: 'hold', seconds: 2.0, phase: 'close', entrance: 'slide', cut: 'whip', world: 'halo', air: 'none', note: 'end hold: price and name' },
      ],
    },
    {
      concept: `${p.title}: one bright thing in a dark world`,
      mood: 'low-key, glowing',
      tone: 'warm',
      key: 'low',
      tagline: sale ? 'Less to pay, more to love' : 'Your moment starts here',
      shots: [
        { size: 'macro', move: 'pull', seconds: 0.9, phase: 'hook', entrance: 'none', cut: 'flash', world: 'halo', air: 'bokeh', text: 'Look closer', note: 'hook: out of the detail' },
        { size: 'wide', move: 'push', seconds: 1.0, phase: 'build', entrance: 'tumble', cut: 'whip', world: 'field', air: 'dust', note: 'it tumbles in small and we push' },
        { size: 'close', move: 'sway', seconds: 0.8, phase: 'build', entrance: 'none', cut: 'hard', world: 'halo', air: 'none', note: 'close, it sways in the light' },
        { size: 'medium', move: 'push', seconds: 0.9, phase: 'peak', entrance: 'drop', cut: 'flash', world: wide, air: sale ? 'confetti' : 'bokeh', text: sale ? 'Now on sale' : 'Pure feeling', note: 'the peak: it lands in a burst of light' },
        { size: 'medium', move: 'dolly-zoom', seconds: 1.0, phase: 'reveal', entrance: 'none', cut: 'hard', world: 'halo', air: 'none', note: 'the reveal: the world grows round it' },
        { size: 'close', move: 'hold', seconds: 1.9, phase: 'close', entrance: 'none', cut: 'hard', world: 'halo', air: 'none', note: 'end hold under the halo' },
      ],
    },
    {
      concept: `${p.title}: fast cuts that build to one hero`,
      mood: 'energetic, colourful',
      tone: 'cool',
      key: 'high',
      tagline: sale ? 'Big price drop, small window' : 'Bring on the good days',
      shots: [
        { size: 'medium', move: 'push', seconds: 0.8, phase: 'hook', entrance: 'slide', cut: 'hard', world: 'field', air: sale ? 'confetti' : 'dust', text: sale ? 'Sale!' : 'Ready?', note: 'hook: it slides in and we push' },
        { size: 'macro', move: 'push', seconds: 0.6, phase: 'build', entrance: 'none', cut: 'whip', world: 'halo', air: 'none', note: 'detail' },
        { size: 'wide', move: 'push', seconds: 0.8, phase: 'build', entrance: 'drop', cut: 'whip', world: wide, air: 'dust', note: 'small in its world' },
        { size: 'close', move: 'sway', seconds: 0.7, phase: 'build', entrance: 'none', cut: 'hard', world: 'field', air: 'bokeh', text: 'Feel the difference', note: 'close sway' },
        { size: 'medium', move: 'push', seconds: 1.0, phase: 'peak', entrance: 'tumble', cut: 'flash', world: 'halo', air: sale ? 'confetti' : 'bokeh', note: 'the peak' },
        { size: 'wide', move: 'pull', seconds: 0.9, phase: 'reveal', entrance: 'none', cut: 'hard', world: wide, air: 'none', note: 'pull out' },
        { size: 'medium', move: 'hold', seconds: 1.9, phase: 'close', entrance: 'none', cut: 'hard', world: 'halo', air: 'none', note: 'end hold' },
      ],
    },
  ];
  return templates[hash(p.title) % templates.length]!;
}

export interface PlannedCatalogBoard {
  board: CatalogBoard;
  /** muse: Muse wrote it and it passed; floor: Muse failed twice, so a floor board stands in. */
  source: 'muse' | 'floor';
  /** The rule breaks left from Muse's last try (empty when source is muse). */
  violations: string[];
  usd: number;
}

/** What one Spark vision call costs here; the same figure the 3D board charges. */
export const BOARD_USD = 0.005;

/**
 * Asks Muse (Spark vision, looking at the photo) for the board; once more with the broken rules and the board that broke them when
 * the first fails the checker; else the floor board. About $0.005 a call.
 */
export async function planCatalogBoard(ctx: ToolCtx, p: BoardProduct, photo: Buffer, o: { hasPlate: boolean }): Promise<PlannedCatalogBoard> {
  let violations: string[] = [];
  let previous: CatalogBoard | undefined;
  let usd = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    const prompt = catalogBoardPrompt(p, { hasPlate: o.hasPlate, violations, ...(previous ? { previous } : {}) });
    try {
      const reply = await ctx.meta.spark.reviewImages([photo], `${prompt.system}\n\n${prompt.user}`);
      ctx.ledger.add(ctx.filmId, 'muse-spark-1.3-contributor', '1 call', BOARD_USD);
      usd += BOARD_USD;
      const parsed = parseCatalogBoard(reply);
      if (!parsed.ok) {
        violations = [`the reply could not be read: ${parsed.reason}`];
        continue;
      }
      const board = o.hasPlate ? parsed.board : { ...parsed.board, shots: parsed.board.shots.map((s) => (s.world === 'plate' ? { ...s, world: 'halo' as const } : s)) };
      violations = checkCatalogBoard(board);
      previous = board;
      if (!violations.length) return { board, source: 'muse', violations: [], usd };
    } catch (err) {
      violations = [`the call failed: ${err instanceof Error ? err.message : String(err)}`.slice(0, 200)];
    }
  }
  return { board: floorCatalogBoard(p, o), source: 'floor', violations, usd };
}
