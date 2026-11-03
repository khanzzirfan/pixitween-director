import type { Buffer } from 'node:buffer';
import { z } from 'zod';
import type { ToolCtx } from '@shared/tools';
import { RATE_MAX, RATE_MIN, type RatePoint } from '@engine/core/speedRamp';
import { referenceDeck } from './reference-deck';
import { CUT_SHADERS, FINISH_LEVELS, SHEET, SPOT, TEXT_RULES, VOCAB } from './cinematic-rules';
import { SET_AIR, SET_HELP, SET_LOOKS, SET_TEXTURES, type BoardSet } from './set-art';
import { floorElements, sanitizeElements, MAX_ELEMENTS, type ElementSpec, type IngredientAction, type IngredientUse } from './ingredients';

// The cinematic board: what one 3D product film is made of (docs/direction/corpus/06-reference-films.md). Muse looks at the product photo and
// writes the board: a concept line, the elements that belong round this product (beans, a splash, a lemon slice...) and the shot list that uses
// them. A checker holds the shots to what the reference films do and every element to being used; the builder (cinematic-film.ts) plays the board
// as camera moves and element motions in one stage3d world. Pure except planBoard, which makes one Spark call (about $0.005).

export const SHOT_SIZES = ['wide', 'medium', 'close', 'macro'] as const;
/**
 * The camera's moves. push: in on the product. pull: out, the payoff. hold: stays (and drifts). orbit: swings round the product on an arc.
 * truck: slides sideways past the set while the product stays centred (the strongest parallax: the world streams by). crane: rises or falls
 * while looking at the product (a low angle to a high one, or back). whip: a fast swing that brakes into the frame, for a quick cut (short
 * shots only). rack: the focus moves from the near lights to the product while the camera creeps in. dolly-zoom: the lens widens while the
 * product holds its size.
 */
export const MOVES = ['push', 'pull', 'hold', 'orbit', 'truck', 'crane', 'whip', 'rack', 'dolly-zoom'] as const;
/** One line each, for Muse's prompt (the rule book's words). */
export const MOVE_HELP: Record<(typeof MOVES)[number], string> = VOCAB.moves;
export const ACTIONS = ['fall', 'burst', 'orbit', 'drift', 'splash', 'swirl', 'pour', 'rise', 'wrap'] as const;
/** Camera height: low looks up at the product (power), eye is level, high looks down on it. */
export const ANGLES = ['low', 'eye', 'high'] as const;
/** Where the shot sits in the film's story: an optional label (spray plays in the shot marked peak); nothing checks the order. */
export const PHASES = ['hook', 'build', 'peak', 'reveal', 'close'] as const;
/** What the product does in the shot: still, turns, or drops in from above. */
export const PRODUCT_MOVES = ['still', 'turn', 'drop'] as const;
/** How the shot starts: hard cut, a wipe (a quick dip to dark) or a cloud (a bloom of light fills the frame). */
export const CUTS = ['hard', 'wipe', 'cloud', 'zoom', 'whip', 'lenswhip', 'spin', 'punch', 'ripple', 'swirl', 'glitch', 'burn', 'leak', 'streak', 'iris', 'dream', 'defocus', 'melt', 'flash', 'pass', 'match'] as const;
/** The cuts that happen inside the scene (a light flash, the camera plunging through the product, a match on its framing): no second render of the world, so they do not count in the shader-cut limit. */
export const IN_SCENE_CUTS: ReadonlyArray<(typeof CUTS)[number]> = ['flash', 'pass', 'match'];
/** The shader cuts as the prompt shows them to Muse: each word with what it looks like and when a story wants it. */
const SHADER_CUT_NOTES = Object.entries(CUT_SHADERS)
  .filter(([k]) => k !== 'max')
  .map(([word, d]) => `${word}: ${(d as { use: string }).use}`)
  .join('; ');
/** Directions a travelling cut (whip, lenswhip, leak) can take. */
/** Where a board's spot light stands round the product. */
export const SPOT_SIDES = ['left', 'right', 'above', 'behind', 'front'] as const;
export interface BoardSpot {
  side: (typeof SPOT_SIDES)[number];
  color?: string;
  strength?: number;
  cone?: number;
  soft?: number;
}
/** The reflection studios a board can light its shiny things with. */
export const REFLECTIONS = ['room', 'softbox', 'ring', 'sunset', 'none'] as const;
export const CUT_DIRS = ['left', 'right', 'up', 'down'] as const;
export const TONES = ['warm', 'cool', 'neutral'] as const;
/**
 * How a shot's camera gets from its start to its end. through: keeps speed through both ends (cuts land on a moving camera). snap: fast
 * start, settles. smooth: eases in and out (calm, premium). linear: constant speed (the dolly-zoom's drift, a slow slide). whip: almost
 * all of it in the first fifth, then brakes. float: barely moves, then drifts on (dreamy).
 */
export const EASES = ['through', 'snap', 'smooth', 'linear', 'whip', 'float'] as const;
/** Where an element plays relative to the product: in front of it (toward the lens), behind it, or round it at its own depth. */
export const PLACES = ['front', 'behind', 'around'] as const;
/**
 * One end of a shot's camera, every field optional (a missing one keeps what the move gives). fill: how much of the frame's height the
 * product fills (0.1 tiny in its world, 0.5 at ease, 0.8 fills it, 1.5 a crop of the label). height: degrees the camera looks down on the
 * product (negative looks up). around: degrees round the product (0 straight on, 90 its side). lens: field of view in degrees (14 long
 * lens, flat and compressed; 30 normal; 80 very wide, stretched). side: the camera slid sideways, as a share of its distance (-0.6 to 0.6).
 */
export interface CameraPoint {
  fill?: number;
  height?: number;
  around?: number;
  lens?: number;
  side?: number;
}
/** The camera of one shot written out by Muse: where it starts and ends, how it moves between them, and what is in focus. Overrides the move's own numbers. */
export interface ShotCamera {
  from?: CameraPoint;
  /** Points the camera passes through between `from` and `to` (up to 3), in order: the path is a smooth curve through them, not a straight line. A field left out is what the straight path would have there. */
  via?: CameraPoint[];
  to?: CameraPoint;
  ease?: (typeof EASES)[number];
  /** product: the product stays sharp. rack: the focus starts near the lens and runs back to the product. Or a focus pull written out (ShotFocus). */
  focus?: 'product' | 'rack' | ShotFocus;
  /** How much the hand-held tremor shakes in this shot, as a multiple of the film's (0 locks the camera off for the shot, 2 shakes twice as hard). */
  shake?: number;
}
/** What the lens focuses on: the near things (a piece falling toward it), the product, or the far set behind it. */
export const FOCUS_TARGETS = ['near', 'product', 'far'] as const;
export type FocusTarget = (typeof FOCUS_TARGETS)[number];
/** A focus pull: where the focus starts and ends in a shot, and aperture (0 sharp everywhere, 0.3 the film's, 1 shallow: how strongly the rest goes soft and bokeh blooms). */
export interface ShotFocus {
  from?: FocusTarget;
  to?: FocusTarget;
  aperture?: number;
}
/** The hand-held tremor written out: amount (a multiple of the usual, 0.3 a breath, 2 a nervous camera), keys (how many wobbles a shot, 1 slow drift to 6 jitter) and seed (a whole number: another seed shakes another way). */
export interface Handheld {
  amount?: number;
  keys?: number;
  seed?: number;
}
/** The screen grade over the world: how much the bright things glow, how much film grain, how dark the corners, and a colour fringe at the edges. */
export interface Finish {
  glow: 'none' | 'soft' | 'strong';
  grain: 'none' | 'fine' | 'heavy';
  vignette: 'none' | 'soft' | 'strong';
  fringe: boolean;
  /** How shiny the floor is: a reflection of the product in it (only on a set with a floor). */
  floor: 'none' | 'matte' | 'glossy' | 'mirror';
  /** Beads of condensation on the product: a cold can or a dewy bottle. */
  wet: 'none' | 'light' | 'heavy';
  /** Rippling light on the floor round the product, as a glass of liquid or a pool throws it (only on a set with a floor). */
  caustics: 'none' | 'soft' | 'bright';
}
/** The finish a board gets when it picks none: from its key level (a low key glows and darkens, a high key stays clean and airy). */
export function defaultFinish(key: 'low' | 'mid' | 'high' | undefined): Finish {
  if (key === 'low') return { glow: 'strong', grain: 'fine', vignette: 'strong', fringe: false, floor: 'glossy', wet: 'none', caustics: 'none' };
  if (key === 'high') return { glow: 'soft', grain: 'none', vignette: 'none', fringe: false, floor: 'none', wet: 'none', caustics: 'none' };
  return { glow: 'soft', grain: 'fine', vignette: 'soft', fringe: false, floor: 'matte', wet: 'none', caustics: 'none' };
}
const finishSchema = z.object({
  glow: z.enum(FINISH_LEVELS.glow).catch('soft'),
  grain: z.enum(FINISH_LEVELS.grain).catch('fine'),
  vignette: z.enum(FINISH_LEVELS.vignette).catch('soft'),
  fringe: z.boolean().catch(false),
  floor: z.enum(FINISH_LEVELS.floor).catch('matte'),
  wet: z.enum(FINISH_LEVELS.wet).catch('none'),
  caustics: z.enum(FINISH_LEVELS.caustics).catch('none'),
});
/**
 * The end card as Muse styles it. plate: what sits behind the words (a pill, a full-width bar, nothing but a shadow). price: a round disc, a
 * rounded tag, or plain big type. align: the name and tagline centred or set to the left margin. text: as written or in capitals. weight: how
 * heavy the name is. accent: the colour of the disc or tag (otherwise the product's own). pulse: whether the price beats with the music.
 */
export const END_PLATES = ['pill', 'bar', 'none'] as const;
export const END_PRICES = ['disc', 'tag', 'plain'] as const;
export const END_ALIGNS = ['center', 'left'] as const;
export const END_CASES = ['normal', 'upper'] as const;
export const END_WEIGHTS = ['light', 'regular', 'bold'] as const;
export interface EndCard {
  plate?: (typeof END_PLATES)[number];
  price?: (typeof END_PRICES)[number];
  align?: (typeof END_ALIGNS)[number];
  text?: (typeof END_CASES)[number];
  weight?: (typeof END_WEIGHTS)[number];
  accent?: string;
  pulse?: boolean;
}
const hexColour = z.string().regex(/^#[0-9a-fA-F]{6}$/).transform((h) => h.toLowerCase());
const endCardSchema = z.object({
  plate: z.enum(END_PLATES).optional().catch(undefined),
  price: z.enum(END_PRICES).optional().catch(undefined),
  align: z.enum(END_ALIGNS).optional().catch(undefined),
  text: z.enum(END_CASES).optional().catch(undefined),
  weight: z.enum(END_WEIGHTS).optional().catch(undefined),
  accent: hexColour.optional().catch(undefined),
  pulse: z.boolean().optional().catch(undefined),
});
export const KEY_LEVELS = ['low', 'mid', 'high'] as const;
export type Tone = (typeof TONES)[number];
export type KeyLevel = (typeof KEY_LEVELS)[number];
export type ShotSize = (typeof SHOT_SIZES)[number];
export type Move = (typeof MOVES)[number];
export type Angle = (typeof ANGLES)[number];
export type Phase = (typeof PHASES)[number];
export type ProductMove = (typeof PRODUCT_MOVES)[number];
export type Cut = (typeof CUTS)[number];

/**
 * What the product does in a shot, written out by Muse. degrees: how far it turns about its upright axis over the shot (a quarter turn is 90,
 * a full spin 360, a negative number turns the other way; a flat cut-out only swings a little). ease: how the turn speeds up and slows.
 * tilt: degrees it leans forward or back at the middle of the shot and returns from. roll: degrees it rolls sideways at the middle.
 * lift: how high it is tossed at the middle, in product heights (0.5 a hop, 1.5 a toss). All optional; the shot's own `product` is the fallback.
 */
export interface Spin {
  degrees?: number;
  ease?: (typeof EASES)[number];
  tilt?: number;
  roll?: number;
  lift?: number;
}
/**
 * The light in one shot. from and to: the key light's direction at the start and the end of the shot, in degrees round the product (0 in
 * front of it, -90 from its left, 90 from its right, 180 behind it: a light that slides across the label sweeps a bright streak over it).
 * elevation: degrees above the horizon (5 grazing, 80 overhead). key and rim: the strength of the key and the rim light in this shot, as a
 * multiple of the film's own (1 as it is, 0 off, 2 twice as hard).
 */
export interface ShotLight {
  from?: number;
  to?: number;
  elevation?: number;
  key?: number;
  rim?: number;
}
/** The colours of the film's two lights (otherwise the key follows the tone and the rim is white): a warm key with a cold rim is the classic commercial look. */
/**
 * The colour grade over the whole film, every field optional. exposure (-0.3 darker to 0.3 brighter), contrast (0 to 0.5), saturation (-1 grey to 1 vivid) and
 * hue (-40 to 40 degrees) are the tone controls. shadows and highlights are #rrggbb tints for the dark and the bright parts (split toning, as in teal and
 * orange), split how strongly (0 to 1, 0.5 if left out) and balance where the line between them falls (-1 to 1). streak: a horizontal lens streak drawn
 * through every bright light (colour, strength 0 to 2, reach 0.02 to 0.6 of the frame's width). halation: a soft glow round the highlights, 0 to 1.
 * letterbox: black bars to a wide ratio (1.85 to 2.6; 2.39 is the cinema's); in a tall frame each bar stops at 30 % of the height, and the bars lift for the end card.
 */
export interface Grade {
  exposure?: number;
  contrast?: number;
  saturation?: number;
  hue?: number;
  shadows?: string;
  highlights?: string;
  split?: number;
  balance?: number;
  streak?: { color?: string; strength?: number; reach?: number };
  halation?: number;
  letterbox?: number;
}
/** The solid body a flat cut-out is built into: how deep it is (a share of its width) and how round its cross-section is. */
export interface BoardBody {
  depth?: number;
  section?: number;
}

export interface BoardLight {
  key?: string;
  rim?: string;
}
export interface Beat {
  /** The framing the shot is about: the camera ends here for a push or pull and stays here for an orbit. A hold and a dolly-zoom ignore it and continue the shot before. */
  size: ShotSize;
  move: Move;
  seconds: number;
  /** Camera height; absent means eye level. A hold keeps the height of the shot before. */
  angle?: Angle;
  phase?: Phase;
  product?: ProductMove;
  cut?: Cut;
  /** What the world does in this shot, from the product's ingredient set: its action, and optionally where it plays and how big. */
  ingredient?: { kind: string; action: IngredientAction; place?: (typeof PLACES)[number]; scale?: number };
  /** The camera written out; absent means the move's own numbers. */
  camera?: ShotCamera;
  /** The product's turn, tilt, roll and toss written out; absent means what `product` gives. */
  spin?: Spin;
  /** The light in this shot; absent means the film's own light. */
  light?: ShotLight;
  /** The shot's speed over its time, as points of a curve (`at` the share of the shot, `rate` the speed: 1 normal, 0.2 a fifth): slow motion that snaps back. Absent means normal speed throughout. */
  ramp?: RatePoint[];
  /** Which way a whip, lenswhip or leak cut into this shot travels; absent means the cut's own direction. */
  dir?: (typeof CUT_DIRS)[number];
  /** Motion blur of this shot as a share of a frame's time the shutter stays open (0 none, 0.5 the film look, 1 smeared); absent means the film's own. */
  blur?: number;
  /** One line a person can read on the board. */
  /** The words on screen in this shot (a hook line, a feeling): never the price, the name or the brand, which land in the end hold. */
  text?: string;
  note?: string;
}
export interface BeatSheet {
  beats: Beat[];
}

/** A number Muse wrote, held to [lo, hi] (a wild value is pulled to the edge, not thrown away); a non-number is dropped. */
const within = (lo: number, hi: number) =>
  z
    .number()
    .transform((n) => Math.min(hi, Math.max(lo, n)))
    .optional()
    .catch(undefined);
const pointSchema = z.object({ fill: within(0.08, 1.8), height: within(-25, 70), around: within(-180, 180), lens: within(12, 95), side: within(-0.6, 0.6) });

const focusSchema = z.union([z.enum(['product', 'rack']), z.object({ from: z.enum(FOCUS_TARGETS).optional().catch(undefined), to: z.enum(FOCUS_TARGETS).optional().catch(undefined), aperture: within(0, 1) })]);
const cameraSchema = z.object({
  from: pointSchema.optional().catch(undefined),
  via: z.array(pointSchema).transform((a) => a.slice(0, 3)).optional().catch(undefined),
  to: pointSchema.optional().catch(undefined),
  ease: z.enum(EASES).optional().catch(undefined),
  focus: focusSchema.optional().catch(undefined),
  shake: within(0, 3),
});
const handheldSchema = z.union([z.boolean(), z.object({ amount: within(0, 3), keys: z.number().transform((n) => Math.min(6, Math.max(1, Math.round(n)))).optional().catch(undefined), seed: z.number().transform((n) => Math.round(n) % 1000).optional().catch(undefined) })]);
const spinSchema = z.object({ degrees: within(-720, 720), ease: z.enum(EASES).optional().catch(undefined), tilt: within(-40, 40), roll: within(-30, 30), lift: within(0, 2) });
const shotLightSchema = z.object({ from: within(-180, 180), to: within(-180, 180), elevation: within(5, 85), key: within(0, 2.5), rim: within(0, 3) });
const gradeSchema = z.object({
  exposure: within(-0.3, 0.3),
  contrast: within(0, 0.5),
  saturation: within(-1, 1),
  hue: within(-40, 40),
  shadows: hexColour.optional().catch(undefined),
  highlights: hexColour.optional().catch(undefined),
  split: within(0, 1),
  balance: within(-1, 1),
  streak: z.object({ color: hexColour.optional().catch(undefined), strength: within(0, 2), reach: within(0.02, 0.6) }).optional().catch(undefined),
  halation: within(0, 1),
  letterbox: within(1.85, 2.6),
});
const boardBodySchema = z.object({ depth: within(0.05, 1.2), section: within(1, 6) });
const spotSchema = z.object({ side: z.enum(SPOT_SIDES), color: hexColour.optional().catch(undefined), strength: within(0.2, 3), cone: within(SPOT.cone.min, SPOT.cone.max), soft: within(0, 1) });
const boardLightSchema = z.object({ key: hexColour.optional().catch(undefined), rim: hexColour.optional().catch(undefined) });
const beatSchema = z.object({
  size: z.enum(SHOT_SIZES),
  move: z.enum(MOVES),
  seconds: z.number().positive().max(6),
  angle: z.enum(ANGLES).optional(),
  phase: z.enum(PHASES).optional(),
  product: z.enum(PRODUCT_MOVES).optional(),
  cut: z.enum(CUTS).optional(),
  ingredient: z.object({ kind: z.string().min(1).max(30), action: z.enum(ACTIONS), place: z.enum(PLACES).optional().catch(undefined), scale: within(0.3, 2.5) }).optional(),
  camera: cameraSchema.optional().catch(undefined),
  spin: spinSchema.optional().catch(undefined),
  light: shotLightSchema.optional().catch(undefined),
  ramp: z.array(z.object({ at: z.number().transform((n) => Math.min(1, Math.max(0, n))), rate: z.number().transform((n) => Math.min(RATE_MAX, Math.max(RATE_MIN, n))) })).min(1).max(5).optional().catch(undefined),
  dir: z.enum(CUT_DIRS).optional().catch(undefined),
  blur: within(0, 1),
  text: z.string().max(40).optional(),
  note: z.string().max(140).optional(),
});

/** The rules from the reference films: hook in the first beat, 0.4-2.5 s cuts, the last shot holds 12-37 % of the runtime, push-in leads. */
export const SHEET_RULES = SHEET;

/** How the product's ingredient kinds may be used: solids fall, burst, orbit or drift; cards splash or swirl; liquids splash, pour, swirl or drift; vapours rise, wrap or burst. */
const ACTIONS_FOR: Record<IngredientUse, readonly IngredientAction[]> = { solid: ['fall', 'burst', 'orbit', 'drift'], card: ['splash', 'swirl'], liquid: ['splash', 'pour', 'swirl', 'drift'], vapour: ['rise', 'wrap', 'burst'] };

/** A hold continues the framing of the shot before, so the size a person sees is that shot's; every other move sets its own (a dolly-zoom holds the size it names, but never a macro: the end hold that follows it must leave room for the price, so a macro dolly-zoom is framed as a close). */
export const effectiveSizes = (sheet: BeatSheet): ShotSize[] => {
  const out: ShotSize[] = [];
  sheet.beats.forEach((b, i) => out.push(b.move === 'hold' ? (out[i - 1] ?? b.size) : b.move === 'dolly-zoom' && b.size === 'macro' ? 'close' : b.size));
  return out;
};
/** The camera height each shot plays at: eye level unless named; a hold keeps the height of the shot before. */
export const effectiveAngles = (sheet: BeatSheet): Angle[] => {
  const out: Angle[] = [];
  sheet.beats.forEach((b, i) => out.push(b.move === 'hold' ? (out[i - 1] ?? b.angle ?? 'eye') : (b.angle ?? 'eye')));
  return out;
};
export const totalSeconds = (sheet: BeatSheet): number => Math.round(sheet.beats.reduce((s, b) => s + b.seconds, 0) * 100) / 100;

/**
 * Every way the sheet would break the film, as sentences Muse can act on. Only breakage is checked: the film's length, the end hold where
 * the price lands, an element the set does not have or cannot do that, words that cannot be read, a budget the engine cannot render. Taste
 * (which shots, which moves, how many, in what order, where the peak sits) is Muse's, and is never checked.
 */
export function sheetBreaks(sheet: BeatSheet, elements: readonly ElementSpec[]): string[] {
  const R = SHEET_RULES;
  const v: string[] = [];
  const bs = sheet.beats;
  const total = totalSeconds(sheet);
  if (bs.length < R.minBeats || bs.length > R.maxBeats) v.push(`use ${R.minBeats} to ${R.maxBeats} shots (got ${bs.length})`);
  if (total < R.minTotal || total > R.maxTotal) v.push(`the film must run ${R.minTotal} to ${R.maxTotal} seconds (got ${total})`);
  bs.forEach((b, i) => {
    const last = i === bs.length - 1;
    if (!last && (b.seconds < R.minBeat || b.seconds > R.maxBeat)) v.push(`shot ${i + 1} lasts ${b.seconds} s; every shot but the last lasts ${R.minBeat} to ${R.maxBeat} s`);
    if (b.ingredient) {
      const def = elements.find((e) => e.id === b.ingredient!.kind);
      if (!def) v.push(`shot ${i + 1} uses "${b.ingredient.kind}", which is not one of the elements (${elements.map((e) => e.id).join(', ')})`);
      else if (!ACTIONS_FOR[def.use].includes(b.ingredient.action)) v.push(`shot ${i + 1}: a ${def.use} element ("${def.id}") can only ${ACTIONS_FOR[def.use].join(', ')}, not ${b.ingredient.action}`);
    }
  });
  const end = bs.at(-1);
  if (end) {
    if (end.move !== 'hold') v.push('the last shot must be a hold: the price and brand rest there');
    const share = total > 0 ? end.seconds / total : 0;
    if (share < R.holdMin || share > R.holdMax) v.push(`the end hold must be ${Math.round(R.holdMin * 100)}-${Math.round(R.holdMax * 100)}% of the film (it is ${Math.round(share * 100)}%)`);
    if (end.ingredient) v.push('keep the last shot clear of ingredients so the price reads');
    if (end.product && end.product !== 'still') v.push('the product holds still in the last shot');
  }
  const texts = bs.map((b, i) => ({ b, i })).filter(({ b }) => b.text?.trim());
  if (texts.length > TEXT_RULES.maxShots) v.push(`at most ${TEXT_RULES.maxShots} shots carry text`);
  for (const { b, i } of texts) {
    const n = b.text!.trim().split(/\s+/).length;
    if (i === bs.length - 1) v.push('the last shot carries no text: the price, name and tagline land there');
    if (n > TEXT_RULES.maxWords) v.push(`shot ${i + 1}: at most ${TEXT_RULES.maxWords} words on screen (got ${n})`);
    else if (n > Math.max(TEXT_RULES.minWords, Math.floor(b.seconds * TEXT_RULES.wordsPerSecond))) v.push(`shot ${i + 1} lasts ${b.seconds} s: it can take only ${Math.max(TEXT_RULES.minWords, Math.floor(b.seconds * TEXT_RULES.wordsPerSecond))} words`);
    if (/[$€£¥₹]|\d/.test(b.text!)) v.push(`shot ${i + 1}: the price never goes in a shot's words; it lands in the end hold, and words carry no numbers`);
  }
  if (bs.filter((b) => b.cut && b.cut !== 'hard' && !IN_SCENE_CUTS.includes(b.cut)).length > CUT_SHADERS.max) v.push(`use at most ${CUT_SHADERS.max} cuts that are not a plain cut (hard): each one renders the world twice`);
  return v;
}

/** Every way the sheet would break the film, as sentences Muse can act on; empty when it passes. `elements` is the set the sheet may use. */
export function checkBeatSheet(sheet: BeatSheet, elements: readonly ElementSpec[]): string[] {
  return sheetBreaks(sheet, elements);
}

/**
 * The director's floor sheet: 8 s, the grammar of the latte-can and iced-coffee references. Used when Muse's sheet fails the checker twice.
 * It gives each element a shot that suits it (a solid falls, bursts, orbits or drifts; a card splashes or swirls) and skips a beat's element
 * when the set has none of the right use. Every element is used when there are at most four.
 */
export function defaultBeatSheet(elements: readonly ElementSpec[]): BeatSheet {
  const pool = [...elements];
  const take = (...prefer: Array<(e: ElementSpec) => boolean>): ElementSpec | undefined => {
    for (const want of prefer) {
      const at = pool.findIndex(want);
      if (at >= 0) return pool.splice(at, 1)[0];
    }
    return undefined;
  };
  const solid = (e: ElementSpec) => e.use === 'solid' && !e.glass;
  const glass = (e: ElementSpec) => !!e.glass;
  const flip = (e: ElementSpec) => e.use === 'liquid' || (e.use === 'card' && e.pieces > 1);
  const card = (e: ElementSpec) => e.use === 'card' || e.use === 'liquid' || e.use === 'vapour';
  const any = () => true;
  // a vapour rises behind the product, wraps round it where the shot wants a splash, and bursts where it wants a burst
  const vapourAct = (a: IngredientAction): IngredientAction => (a === 'burst' ? 'burst' : a === 'splash' ? 'wrap' : 'rise');
  const ing = (e: ElementSpec | undefined, action: IngredientAction): Pick<Beat, 'ingredient'> => (e ? { ingredient: { kind: e.id, action: e.use === 'vapour' ? vapourAct(action) : action } } : {});
  // each shot takes the element that suits it best; any kind can fill any shot, so up to five elements are all used
  const hook = take(solid, glass, card);
  const land = take(flip, card, solid, glass);
  const orbiter = take(glass, solid, card);
  const swirl = take(card, solid, glass);
  const floaty = take(any);
  const act = (e: ElementSpec | undefined, hookish: IngredientAction, prefer: IngredientAction): IngredientAction =>
    e && e.use === 'liquid'
      ? hookish === 'fall' ? 'pour' : prefer === 'splash' ? 'splash' : 'swirl'
      : e && e.use === 'card' ? (hookish === 'fall' ? 'swirl' : prefer === 'splash' && e.pieces > 1 ? 'splash' : 'swirl') : hookish === 'fall' ? 'fall' : prefer;
  const flowing = (e: ElementSpec | undefined) => e?.use === 'card' || e?.use === 'liquid';
  return {
    beats: [
      { size: 'wide', move: 'push', seconds: 1.0, angle: 'low', phase: 'hook', product: 'drop', ...ing(hook, act(hook, 'fall', 'fall')), note: 'hook: an element falls past the lens while the camera pushes in and the can drops in' },
      { size: 'medium', move: 'truck', seconds: 0.9, angle: 'eye', phase: 'build', product: 'turn', cut: 'wipe', ...ing(land, flowing(land) ? act(land, 'drift', 'splash') : 'burst'), note: 'the camera trucks sideways past the set while the can turns and an element splashes or bursts' },
      { size: 'macro', move: 'push', seconds: 0.9, angle: 'eye', phase: 'build', product: 'still', note: 'label macro: push to the label, the can faces the lens' },
      { size: 'close', move: 'orbit', seconds: 1.1, angle: 'low', phase: 'build', product: 'still', ...ing(orbiter, flowing(orbiter) ? 'swirl' : 'orbit'), note: 'the camera swings round while an element orbits' },
      { size: 'medium', move: 'push', seconds: 1.1, angle: 'high', phase: 'peak', product: 'still', cut: 'cloud', ...ing(swirl, flowing(swirl) ? 'swirl' : 'drift'), note: 'sensory peak: an element wraps the can as the camera pushes in from above' },
      { size: 'medium', move: 'dolly-zoom', seconds: 1.0, angle: 'eye', phase: 'reveal', product: 'still', ...ing(floaty, flowing(floaty) ? 'swirl' : 'drift'), note: 'reveal: the lens widens, the can holds its size' },
      { size: 'medium', move: 'hold', seconds: 2.0, phase: 'close', product: 'still', note: 'end hold: price and brand' },
    ],
  };
}

const ACTION_HELP = 'fall (solid elements drop through the frame), burst (solid elements fly outward), orbit (solid elements circle the product), drift (solid elements float), splash (a liquid rises in a crown round the product and breaks into drops; a card plays its stages), pour (a liquid falls in a glossy stream beside the product into a pool), swirl (a liquid winds round the product in a spiral ribbon, shedding drops; a card drifts and rolls), drift (a liquid floats round the product as wobbling drops), rise (a vapour rises in soft twisting wisps behind the product), wrap (a vapour rolls round the product as a cloud and clears to reveal it), burst (a vapour bursts out behind the product as fine powder)';

/** The board Muse writes: what the film is about, the elements round the product, and the shots that use them. */
export interface CinematicBoard {
  concept: string;
  mood: string;
  /** The light the builder plays: warm or cool key colour, low-key (dark field, dim halo) or high-key (bright field). Absent means the product's own colour at medium key. */
  tone?: Tone;
  key?: KeyLevel;
  /** The world round the product: the backdrop and floor, and what hangs in the air. Absent means the plain dark field. */
  set?: BoardSet;
  /** The line under the name in the end hold, at most TEXT_RULES.taglineWords words. */
  tagline?: string;
  /** A live, hand-held tremor on the camera. Absent means on: a small sway is how a moving camera feels like a person holding it. */
  handheld?: boolean | Handheld;
  /** The screen grade over the world. Absent means the one its key level gets (defaultFinish). */
  finish?: Finish;
  /** The end card's style. Absent means a centred pill, a round disc and the product's own accent. */
  endCard?: EndCard;
  /** The colours of the key and rim lights. Absent means the key follows the tone and the rim is white. */
  light?: BoardLight;
  /** The product's body: depth as a share of its width, and the section's exponent (2 round, higher boxier). Absent means the film's own. */
  body?: BoardBody;
  /** Spot lights on the product (at most SPOT.max): a pool of light from one side. Absent means none. */
  spots?: BoardSpot[];
  /** What shiny things reflect (chrome, glass, lacquer): the soft room, softbox strips, a ring light, a low sunset, or nothing. Absent means the room. */
  reflect?: (typeof REFLECTIONS)[number];
  /** Motion blur for the whole film, the share of a frame the shutter stays open (0 none, 0.5 the film look). Absent means none. */
  blur?: number;
  /** How much bright points of light spread into discs where the lens is out of focus (0 none, 1 strong). Absent means none. */
  grade?: Grade;
  bokeh?: number;
  /** The lens's base aperture (0 sharp everywhere, 0.3 the film's own, 1 shallow). Absent means 0.3. A shot's focus can write its own. */
  aperture?: number;
  elements: ElementSpec[];
  sheet: BeatSheet;
}

/** The set a floor board gets from the product's words: a beach for summer and water things, else a soft studio. */
export function floorSet(text: string): BoardSet {
  if (/\b(surf\w*|beach|swim\w*|summer|sun\w*|goggles|towel|pool|sea|ocean|holiday)\b/i.test(text)) return { look: 'beach', air: 'dust' };
  if (/\b(garden|plant|herb|tea|organic|natural)\b/i.test(text)) return { look: 'garden', air: 'dust' };
  return { look: 'studio', air: 'dust' };
}

/** A board in the shape Muse writes it (beats at the top). */
const boardJson = (b: CinematicBoard) => ({ concept: b.concept, mood: b.mood, ...(b.endCard ? { endCard: b.endCard } : {}), ...(b.light ? { light: b.light } : {}), ...(b.body ? { body: b.body } : {}), ...(b.blur !== undefined ? { blur: b.blur } : {}), ...(b.grade ? { grade: b.grade } : {}), ...(b.bokeh !== undefined ? { bokeh: b.bokeh } : {}), ...(b.reflect ? { reflect: b.reflect } : {}), ...(b.spots?.length ? { spots: b.spots } : {}), ...(b.aperture !== undefined ? { aperture: b.aperture } : {}), ...(b.tone ? { tone: b.tone } : {}), ...(b.key ? { key: b.key } : {}), ...(b.set ? { set: b.set } : {}), ...(b.handheld !== undefined ? { handheld: b.handheld } : {}), ...(b.finish ? { finish: b.finish } : {}), ...(b.tagline ? { tagline: b.tagline } : {}), elements: b.elements, beats: b.sheet.beats });

/** The prompt that asks Muse (looking at the product photo) for a board. `violations` is set on the retry. */
export function boardPrompt(o: { title: string; brief?: string; brand?: string; category?: string; seconds: number; flat?: boolean; violations?: string[]; previous?: CinematicBoard }): { system: string; user: string } {
  const R = SHEET_RULES;
  return {
    system: [
      'You are the creative director of a short photoreal 3D product ad: the real product in a dark, moody world with real things around it, shot like the best commercials for its kind of product (food, sport, tech, home, fashion, outdoor).',
      referenceDeck(`${o.category ?? ''} ${o.title} ${o.brief ?? ''}`),
      'YOUR TASK. You are shown the product photo. First find its ONE idea (a contrast or a device, as above) and write it as the concept. Then decide what belongs in the film, and write a shot list in which every shot has a reason (the note) that serves the idea. Vary the actions and the lengths of your shots; do not copy the worked boards. Reply with JSON only, in this shape:',
      `{"concept":"one sentence","mood":"a few words","tone":"warm|cool|neutral","key":"low|mid|high","set":{"look":"beach|pool|sunset|sky|studio|night|garden","air":"none|dust|bokeh|spray|smoke","palette?":{"top":"#rrggbb","horizon":"#rrggbb","ground":"#rrggbb","glow?":{"x":0.7,"y":0.7,"color":"#rrggbb","size":0.3},"band?":{"color":"#rrggbb","height":0.09,"foam":false},"stars?":false,"texture?":"none|clouds|spots|rays|bands|grid","accent?":"#rrggbb"}},"endCard?":{"plate":"pill|bar|none","price":"disc|tag|plain","align":"center|left","text":"normal|upper","weight":"light|regular|bold","accent":"#rrggbb","pulse":true},"light?":{"key":"#rrggbb","rim":"#rrggbb"},"body?":{"depth":0.55,"section":2.6},"blur?":0.5,"bokeh?":0.4,"aperture?":0.3,"reflect?":"room|softbox|ring|sunset|none","spots?":[{"side":"left|right|above|behind|front","color?":"#rrggbb","strength?":1,"cone?":24,"soft?":0.6}],"grade?":{"exposure?","contrast?","saturation?","hue?","shadows?":"#rrggbb","highlights?":"#rrggbb","split?","balance?","streak?":{"color?","strength","reach?"},"halation?","letterbox?":2.39},"handheld":true,"finish":{"glow":"none|soft|strong","grain":"none|fine|heavy","vignette":"none|soft|strong","fringe":false,"floor":"none|matte|glossy|mirror","wet":"none|light|heavy","caustics":"none|soft|bright"},"tagline":"at most ${TEXT_RULES.taglineWords} words","elements":[{"id":"slug","name":"what SAM should find","use":"solid|card|liquid|vapour","glass":false,"color":"#rrggbb (liquid or vapour)","clear":false,"look":"one piece, concrete colours and materials","pieces":1,"sizeM":0.02}],"beats":[{"size","move","seconds","angle?","product?","cut?","camera?":{"from?":{"fill","height","around","lens","side"},"via?":[{...}],"to?":{...},"ease?","focus?":"product|rack|{from?,to?,aperture?}","shake?":1},"ingredient?":{"kind":"element id","action","place?","scale?"},"spin?":{"degrees","ease?","tilt?","roll?","lift?"},"light?":{"from","to","elevation","key","rim"},"ramp?":[{"at":0,"rate":1},{"at":0.35,"rate":0.2}],"dir?":"left|right|up|down","blur?":0.5,"text?":"words on screen","note"}]}`,
      `THE SET. The product does not float in nothing: it stands in a place, with depth behind it, so the camera's moves slide the near and far apart (parallax). Pick the look that suits the idea and the campaign: ${SET_LOOKS.map((l) => `${l} (${SET_HELP[l]})`).join('; ')}. Pick the air: ${SET_AIR.join(', ')}; dust is fine specks drifting round the product, bokeh is big soft lights drifting near the lens (use it for warm, festive, night or dreamy films), spray is a burst of droplets in the peak shot (water, fizz, sea), smoke is slow smoke drifting up behind the product the whole film (oud, incense, whisky, night, mystery). Match the set to the light: a low key suits night or sunset, a high key suits beach, pool, sky or garden.`,
      `THE WORLD'S COLOURS are yours. "look" is only a starting recipe; write "set.palette" to paint the world this film needs and every colour you write replaces the look's own: top (the sky overhead), horizon (the sky where it meets the floor; the camera sees mostly this low part), ground (the floor), glow (a light in the sky: x across 0-1, y down 0.3-1 where 0.7 is low and seen, size 0.1 small to 0.6 huge, its colour: a sun, a lamp, a moon, a neon sign), band (a strip along the horizon: a sea, a skyline, hills; height 0.02-0.3), stars, texture (${SET_TEXTURES.join(', ')}: clouds soft blobs, spots warm out-of-focus lights, rays light fanning from the glow, bands soft horizontal haze, grid a faint perspective grid) and accent (the colour of the texture's shapes). Pick colours from the idea and the product (a deep wine red room for a red lipstick, a pale dawn for a calm morning, hot pink and violet for a night out) and do not default to blue; a dark world suits a low key and a pale one a high key, and the ground should be a colour that sits well under the product.`,
      `THE END CARD is styled by you with "endCard", every field optional: plate (${END_PLATES.join(', ')}: what sits behind the name and the words, a rounded pill, a full-width bar, or nothing but a soft shadow), price (${END_PRICES.join(', ')}: a round disc, a rounded tag, or big plain type), align (${END_ALIGNS.join(', ')}: the name and tagline centred or on the left margin), text (${END_CASES.join(', ')}: as written or in capitals), weight (${END_WEIGHTS.join(', ')}: how heavy the name is), accent (#rrggbb: the colour of the disc or tag, otherwise the product's own), pulse (whether the price beats with the music). A calm luxury film might want left-aligned light capitals on no plate and a plain price; a loud one a bold name on a bar and a bright disc.`,
      `THE PRODUCT'S MOTION is yours. A shot's "spin" says what the product does: degrees (how far it turns about its upright axis over the shot: 90 a quarter turn, 360 a full hero spin, -180 half a turn the other way; 0 or none lets it rest), ease (${EASES.join(', ')}: a spin that eases out settles like a turntable, whip throws it round and brakes), tilt (degrees it leans toward or away from the lens at the middle of the shot, -40 to 40), roll (degrees it rolls sideways at the middle), lift (how high it is tossed at the middle, in product heights: 0.5 a hop, 1.5 a toss; it comes back down by the end of the shot). Use it where the idea wants the product to move: a full spin as the reveal, a slow quarter turn under a light sweep, a toss and catch for something playful, nothing for something calm and monumental. A cut-out product is a solid body built from its photo: its back repeats the front picture, so a full spin shows a plausible back, but a slow quarter or half turn sells it best.`,
      `THE LIGHT is yours. "light" at the top sets the colours of the two lights: key (the main light on the product, #rrggbb) and rim (the thin light behind it that outlines its edges, #rrggbb): a warm key with a cold teal or magenta rim is the classic commercial look. A shot's "light" directs the light inside that shot: from and to (degrees round the product where the key light starts and ends: 0 in front, -90 its left, 90 its right, 180 behind; a light that slides from -80 to 70 over a shot sweeps a bright streak across the label, a light behind the product at 160 turns its edges to fire), elevation (5 grazing, 80 overhead), key and rim (how strong each is in that shot as a multiple of the film's, 0 off, 2 twice as hard: a rim at 2.5 on the reveal makes the outline blaze, a key at 0.3 with a hard rim is a silhouette). Give the light a story across the film like the camera has.`,
      `THE PRODUCT'S BODY is yours. The product is built as a solid from its own outline, so it has sides and a back and can turn all the way round. "body" sets its depth (0.05 to 1.2, a share of its width: 0.3 a slim box or pouch, 0.55 a pack, 0.9 a bottle or can nearly as deep as it is wide) and its section (1 to 6: 2 a round bottle or can, 3 to 4 a rounded box or cooler, 5 or more a slab with sharp corners). Judge it from the photo and what the product is; leave it out and the film uses 0.55 and 2.6.`,
      `MOTION BLUR is the shutter. "blur" at the top is how much of each frame's time it stays open (0 none, 0.5 the film look, 1 smeared); a shot's own "blur" replaces it for that shot: sharp for calm holds, 0.7 to 1 for whips and spins so the speed smears the way a real camera shows it.`,
      `THE WORDS. Copy is part of the film. "tagline" is a line of at most ${TEXT_RULES.taglineWords} words that lands under the product name in the last shot (a feeling or a promise, not a slogan cliché). A shot's "text" is the words on screen in that shot, ${TEXT_RULES.minWords} to ${TEXT_RULES.maxWords} words, popped in one after another: a hook line on the first shot, a feeling or a benefit on one or two middle shots. Never the price, the product name or the brand (they land at the end by themselves), never in a macro or the last shot, at most ${TEXT_RULES.maxShots} shots with text, and a short shot takes fewer words (about ${TEXT_RULES.wordsPerSecond} words a second at most). Most shots have no text.`,
      `SPEED is yours. A shot's "ramp" is its speed over its own time, a few points of a curve: at (0 the start of the shot, 1 the end) and rate (the speed there: 1 normal, 0.25 a quarter speed slow motion, 2 double). The speed runs in straight lines between the points, and the shot still ends where it would have, so cuts do not move: a ramp of [{"at":0,"rate":1},{"at":0.3,"rate":0.2},{"at":0.7,"rate":0.2},{"at":1,"rate":1}] opens at full speed, sinks into slow motion for the middle and snaps back to speed before the cut. The camera, the product's spin (when the shot has one) and the world's own motion (a splash, steam, falling pieces) all follow it, so use it where a moment wants to be seen: a splash in slow motion, a toss that hangs at its top, a spin that whips and settles. Rates run ${RATE_MIN} to ${RATE_MAX}. At most 5 points.`,
      `THE GRADE is the colour of the picture, over the whole film, and is yours: write "grade" with any of exposure (-0.3 darker to 0.3 brighter), contrast (0 to 0.5), saturation (-1 grey to 1 vivid), hue (-40 to 40 degrees round the colour wheel) for the tone; shadows and highlights (#rrggbb) to tint the dark parts and the bright parts differently (teal shadows with orange highlights is the cinema look; a cold blue with a warm gold is a luxury one), split (0 to 1, how strongly) and balance (-1 to 1, where the line between dark and bright falls); streak ({"color":"#rrggbb","strength":0 to 2,"reach":0.02 to 0.6 of the frame's width}) to draw a horizontal lens streak through every bright light (a cold blue one is the anamorphic look, for glass, chrome, night and neon); halation (0 to 1) for a soft glow round the highlights, as a diffusion filter gives; and letterbox (1.85 to 2.6; 2.39 is the cinema's) for black bars top and bottom that lift for the end card (in a tall frame the bars stop at 30% of the height each, and the words sit on them, so pair it with a plate). Choose them from the idea; leave out what the film does not want.`,
      'THE FINISH is the screen grade over the whole film, as in a commercial: glow makes bright things bloom (the halo behind a product, a hot rim, a sunlit sky); grain is fine film noise; vignette darkens the corners; fringe:true splits the colours slightly at the edges (energetic, glitchy, sport, tech); floor is how shiny the ground is, a soft reflection of the product in it (mirror for a lacquered black studio or a glass table, glossy for a dark moody set, matte for a soft studio, none for sand, grass or a bright airy set); wet puts beads of condensation on the product (heavy for an ice-cold can or bottle, light for something fresh and dewy, none for anything dry: a trainer, a candle, a gadget). Pick them from the idea: a dark moody low-key film wants a strong glow and a strong vignette, a bright airy one a soft glow and no vignette, a gritty one heavy grain, a clean premium one none.',
      'handheld is true for a live, hand-held sway on the camera (energetic, sport, summer, street, documentary: the default) and false for a calm, locked-off camera (premium, still, studio). It can also be written out: {"amount":0.3 a breath to 2 a nervous camera,"keys":1 a slow drift to 6 a jitter,"seed":a whole number, another seed shakes another way}. "bokeh" (0-1) makes the bright lights in the soft parts of the picture spread into big discs (night, festive, glamour), and "aperture" (0-1) is how shallow the whole film is (0.3 normal). CUTS: a cut should land while the camera is moving, so the shot before leaves at speed and the next enters at speed; the film does this for you, so do not put a hold in the middle of the film.',
      `tone and key set the light the film plays: tone is the colour of the key light, key is low (dark room, one bright object), mid or high (bright, airy). Pick them from the idea and the product's colours.`,
`THE CAMERA is yours. size and move are only a starting preset; write "camera" to direct it exactly. "camera.from" and "camera.to" are where the shot starts and ends, each with any of: fill (how much of the frame the product fills: 0.1 tiny in a huge world, 0.3 small, 0.5 at ease, 0.8 fills it, 1.4 a crop of the label), height (degrees looking down on the product, -10 up at it to 50 from above), around (degrees round the product, 0 straight on, 90 its side, either way), lens (field of view in degrees, 14 very long and compressed, 30 natural, 60 to 85 wide and stretched; ending on a different lens than it started is a dolly-zoom), side (the camera slid across, -0.6 to 0.6 of its distance). "camera.ease" is how it moves: ${EASES.join(', ')}. "camera.via" is up to 3 more points between from and to (same fields, any left out are what a straight path would have there): the camera flows through them on a smooth curve, so it can swing out and round, rise over and settle, or sweep an S-curve, where from and to alone only give a straight line. "camera.focus" is product or rack (the focus runs from near lights back to the product), or a pull you write out: {"from":"near|product|far","to":"near|product|far","aperture":0-1}: near is the pieces close to the lens, product the product, far the set behind it; the lens really goes soft on whatever is not at that distance, so a pull from far to product racks the product sharp out of a blurred set, and a higher aperture makes the soft parts softer (0 sharp everywhere, 0.3 the film's own, 1 very shallow). "camera.shake" is how hard the hand-held tremor shakes in this shot as a multiple of the film's (0 locks the camera, 2 twice as hard). Whatever you write wins over the move; anything you leave out keeps the move's own. Make every shot's camera say something about the idea.`,
`A shot needs only size, move and seconds; every other field is yours to use when the idea wants it. angle (${ANGLES.join(', ')}): camera height. product (${PRODUCT_MOVES.join(', ')}): what the product does. cut (${CUTS.join(', ')}): how the shot starts; hard is a plain cut, wipe dips to dark, cloud blooms light, and three cuts happen inside the scene itself and do not count in that limit: flash (a hot white flash of the key light that fades at once), pass (the product passes the lens as a wipe: the shot before ends by plunging at the product until it fills the frame, and this shot pulls out of that crop, so write pass on the shot that comes AFTER the plunge) and match (a match cut on shape: this shot opens with the product exactly as large and on the same lens as the last shot ended, while the camera angle jumps to somewhere else, so the product stays and the world turns round it); and the rest are shader transitions (${SHADER_CUT_NOTES}): pick the one that suits what the story does at that cut and the mood of the film (a calm premium film wants defocus, dream or iris; an energetic one lenswhip, punch or spin; the same one twice in a film looks careless; whip, lenswhip and leak travel the way "dir" says on that shot: ${CUT_DIRS.join(', ')}), at most ${CUT_SHADERS.max} in the film that are not hard (each renders the world twice). ingredient: an element with its action, and optionally "place" (${PLACES.join(', ')}: in front toward the lens, behind the product, or round it) and "scale" (0.3 to 2.5 times its size).`,
      'Write each note as what the camera, the product or the world DOES in that shot, using only the fields above; the film cannot play anything else (no match cuts, no liquid physics, no text effects).',
      `Elements: 2 to 4 real things that belong round THIS product, chosen from what you see: what it is made of, what it is used with, what it feels like (a coffee can: beans, ice, a milk splash; swim goggles: water droplets, sand, a sea-shell; a camping stove: sparks, pine needles, smoke; a trainer: dust, a grass blade, a mud splash; a jar of honey: a dripping ribbon of honey, a flower). Pick from the product's own world, never from these examples. Never the product itself, people, hands, text, logos or brand names, and no more than ${MAX_ELEMENTS}.`,
      'use "solid" for a small physical object that can fall, fly or orbit (a bean, a slice, a leaf); glass:true for clear things drawn by the engine as glass (ice, sugar, droplets): they need no picture. use "liquid" for ANY liquid (coffee, milk, juice, water, honey, sauce, perfume, oil, a drink): the engine draws real moving 3D liquid that catches the light, so never draw a liquid as a card; give its "color" (#rrggbb, the colour of the liquid itself) and "clear":true when it is see-through (water, a clear perfume, a light juice). use "vapour" for steam, smoke, mist or a cloud of powder or spice: the engine draws soft moving vapour behind and round the product (it never needs an open top), so never draw one as a card; give its "color" (#rrggbb: white steam, grey smoke, brown cocoa). use "card" only for something flat that is neither a liquid nor a vapour and always faces the camera (a sparkle, a flare); a card may be a sequence of 1 to 6 stages in "pieces". sizeM is metres: a solid 0.01-0.08, a card 0.15-0.5, a liquid 0.2-0.42 (the size of its splash), a vapour 0.2-0.5 (how tall it rises; the product is 0.16 m tall). "look" describes one piece, or each stage in order.',
`size is one of ${SHOT_SIZES.join(', ')} (a preset for fill). move is one of ${MOVES.join(', ')}: ${MOVES.map((m) => `${m} = ${MOVE_HELP[m]}`).join('; ')}. action is one of: ${ACTION_HELP}. A solid may fall, burst, orbit or drift; a liquid may splash, pour, swirl or drift; a vapour may rise, wrap or burst; a card may only splash or swirl.`,
`Only these hold the film together: ${R.minBeats}-${R.maxBeats} shots, ${R.minTotal}-${R.maxTotal} s in all; every shot but the last lasts ${R.minBeat}-${R.maxBeat} s; the last shot is a hold of ${R.holdMin * 100}-${R.holdMax * 100}% of the film, with no element and no words, where the price rests. Everything else is yours: how many shots, their order, their lengths, which moves, where a peak sits.`,
'DIRECTOR\'S CRAFT. The client\'s brief may be short and cold; you are the director, so turn it into a film with a point of view: keep every fact it gives (price, claim, mood words, platform) and add what a great commercial adds: a clear idea, one consistent look (one light, one colour world, one lens language), camera and cuts chosen for that idea, and ingredient action that echoes the product\'s story. Make this film look and move unlike a generic one: choose its shape (fast or slow, many shots or few, one long move or many cuts), its lens, its pace and its set for THIS idea. Never contradict the brief.',
    ].join('\n'),
    user: [...(o.brief?.trim() ? [`The client's brief, in their own words (take its facts, add your craft): ${o.brief.trim().slice(0, 600)}`] : []), `Product: ${o.title}${o.brand ? ` by ${o.brand}` : ''}${o.category ? ` (${o.category})` : ''}.`, `Aim for about ${o.seconds} seconds.`, ...(o.flat ? [`The product is a solid body built from its photo's outline (not a turned pack): it can turn, tilt and drop in, and its sides are the photo's edges, so the label macro is a close crop of its front.`] : []), ...(o.violations?.length ? ['Your last board broke these rules; fix them and keep everything else about it as it is:', ...o.violations.map((x) => `- ${x}`)] : []), ...(o.previous && o.violations?.length ? ['Your last board:', JSON.stringify(boardJson(o.previous))] : [])].join('\n'),
  };
}

const num = (lo: number, hi: number, dflt: number) => z.number().transform((n) => Math.min(hi, Math.max(lo, n))).catch(dflt);
const paletteSchema = z.object({
  top: hexColour.optional().catch(undefined),
  horizon: hexColour.optional().catch(undefined),
  ground: hexColour.optional().catch(undefined),
  glow: z.object({ x: num(0, 1, 0.5), y: num(0.3, 1, 0.7), color: hexColour, size: num(0.08, 0.7, 0.3) }).optional().catch(undefined),
  band: z.object({ color: hexColour, height: num(0.02, 0.3, 0.09), foam: z.boolean().optional().catch(undefined) }).optional().catch(undefined),
  stars: z.boolean().optional().catch(undefined),
  texture: z.enum(SET_TEXTURES).optional().catch(undefined),
  accent: hexColour.optional().catch(undefined),
});
const setSchema = z.object({ look: z.enum(SET_LOOKS), air: z.enum(SET_AIR).catch('none'), palette: paletteSchema.optional().catch(undefined) });
const boardSchema = z.object({ concept: z.string().max(240).default(''), mood: z.string().max(80).default(''), set: setSchema.optional().catch(undefined), handheld: handheldSchema.optional().catch(undefined), bokeh: within(0, 1), aperture: within(0, 1), reflect: z.enum(REFLECTIONS).optional().catch(undefined), spots: z.array(spotSchema).max(SPOT.max).optional().catch(undefined), grade: gradeSchema.optional().catch(undefined), finish: finishSchema.optional().catch(undefined), endCard: endCardSchema.optional().catch(undefined), light: boardLightSchema.optional().catch(undefined), body: boardBodySchema.optional().catch(undefined), blur: within(0, 1), tagline: z.string().max(60).optional().catch(undefined), tone: z.enum(TONES).optional().catch(undefined), key: z.enum(KEY_LEVELS).optional().catch(undefined), elements: z.array(z.unknown()).max(8), beats: z.array(beatSchema).min(1).max(14) });

/** Models write `null` for "none" ("ingredient": null); the schema wants the field absent, so every null is removed before parsing. */
function stripNulls(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripNulls);
  if (v !== null && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null).map(([k, x]) => [k, stripNulls(x)]));
  return v;
}

/** The board in a Spark reply (an object or JSON text), or why it could not be read. Elements that fail the safety pass are listed in `dropped`. */
export function parseBoard(raw: unknown, o: { stored?: boolean } = {}): { ok: true; board: CinematicBoard; dropped: string[]; notes: string[] } | { ok: false; reason: string } {
  let data: unknown = raw;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ''));
    } catch {
      return { ok: false, reason: 'not JSON' };
    }
  }
  if (data === null || typeof data !== 'object') return { ok: false, reason: 'empty reply' };
  const r = boardSchema.safeParse(stripNulls(data));
  if (!r.success) return { ok: false, reason: r.error.issues[0]?.message ?? 'wrong shape' };
  const { elements, dropped } = sanitizeElements(r.data.elements);
  // a tagline over the word limit is dropped, not cut: a cut line ends mid-phrase ("Pack the cold, chase"); without one the end card shows the brand
  const notes: string[] = [];
  let tagline = r.data.tagline?.trim().replace(/\s+/g, ' ') || undefined;
  // a board read back from disk was accepted under the rules of its day: its tagline stays (the end card shrinks the type to fit)
  if (!o.stored && tagline && tagline.split(' ').length > TEXT_RULES.taglineWords) {
    // a note, not a rule break: the board is good apart from this line, so it must not fail the checker and send Muse's board to the floor
    notes.push(`tagline "${tagline}" is over ${TEXT_RULES.taglineWords} words and was dropped`);
    tagline = undefined;
  }
  return { ok: true, board: { concept: r.data.concept, mood: r.data.mood, ...(r.data.tone ? { tone: r.data.tone } : {}), ...(r.data.key ? { key: r.data.key } : {}), ...(r.data.set ? { set: r.data.set } : {}), ...(r.data.handheld !== undefined ? { handheld: r.data.handheld } : {}), ...(r.data.finish ? { finish: r.data.finish } : {}), ...(r.data.endCard && Object.values(r.data.endCard).some((v) => v !== undefined) ? { endCard: r.data.endCard } : {}), ...(r.data.light && Object.values(r.data.light).some((v) => v !== undefined) ? { light: r.data.light } : {}), ...(r.data.body && Object.values(r.data.body).some((v) => v !== undefined) ? { body: r.data.body } : {}), ...(r.data.blur !== undefined ? { blur: r.data.blur } : {}), ...(r.data.grade && Object.values(r.data.grade).some((v) => v !== undefined) ? { grade: r.data.grade } : {}), ...(r.data.bokeh !== undefined ? { bokeh: r.data.bokeh } : {}), ...(r.data.reflect ? { reflect: r.data.reflect } : {}), ...(r.data.spots?.length ? { spots: r.data.spots } : {}), ...(r.data.aperture !== undefined ? { aperture: r.data.aperture } : {}), ...(tagline ? { tagline } : {}), elements, sheet: { beats: r.data.beats.map((b) => ({ ...b, seconds: Math.round(b.seconds * 100) / 100 })) } }, dropped, notes };
}

/** A board as it is kept (shots under `sheet`), read back from disk: undefined when it is not a board any more. Elements go through the safety pass again. */
export function readStoredBoard(raw: unknown): CinematicBoard | undefined {
  if (raw === null || typeof raw !== 'object') return undefined;
  const o = raw as { sheet?: { beats?: unknown } };
  const parsed = parseBoard({ ...(raw as object), beats: o.sheet?.beats }, { stored: true });
  return parsed.ok ? parsed.board : undefined;
}

export interface PlannedBoard {
  board: CinematicBoard;
  /** muse: the board came from Spark looking at the photo and passed the checker; floor: Spark failed twice or was not asked, so the floor library and floor sheet were used. */
  source: 'muse' | 'floor';
  /** Rule breaks left over: on a floor board, why Muse's board was not used; on a Muse board, the taste rules it still breaks (none are hard). */
  violations: string[];
  /** Elements Muse proposed that were dropped, with the reason. */
  dropped: string[];
}

/** The floor board: the floor library's elements for the product's words and the floor sheet. */
export function floorBoard(o: { title: string; category?: string }): CinematicBoard {
  const elements = floorElements(o.title, o.category);
  return { concept: `${o.title}, the hero product with the things it is made of`, mood: 'dark, warm, glossy', set: floorSet(`${o.category ?? ''} ${o.title}`), elements, sheet: defaultBeatSheet(elements) };
}

/** Rule breaks in a board as it is: its elements through the safety pass and its shots through the checker. Used on boards read back from disk, which a person may have edited. */
export function reviewBoard(board: CinematicBoard): { board: CinematicBoard; violations: string[]; hard: string[]; dropped: string[] } {
  const { elements, dropped } = sanitizeElements(board.elements);
  // a shot that used an element the safety pass dropped plays without it: the rest of Muse's board stands
  const goneIds = new Set(dropped.map((d) => d.split(':')[0]!.trim()));
  const sheet: BeatSheet = { beats: board.sheet.beats.map((b) => (b.ingredient && goneIds.has(b.ingredient.kind) && !elements.some((e) => e.id === b.ingredient!.kind) ? (({ ingredient: _gone, ...rest }) => rest)(b) : b)) };
  const next = { ...board, elements, sheet };
  const hard = [...(elements.length ? [] : ['list 2 to 4 elements']), ...sheetBreaks(next.sheet, elements)];
  return { board: next, dropped, hard, violations: [...hard, ...dropped.map((d) => `element dropped: ${d}`)] };
}

/**
 * Asks Muse (Spark vision) for the board: the product photo and a short brief in, concept, elements and shots out. Once more with the broken
 * rules AND the board that broke them when the first fails the checker (so Muse mends it instead of starting over), else the floor board. About
 * $0.005 a call. Without a photo it asks with the words alone. `prior` starts from a board already known (a saved one that fails the checker).
 */
export async function planBoard(ctx: ToolCtx, o: { title: string; brief?: string; brand?: string; category?: string; photo?: Buffer; seconds?: number; flat?: boolean; prior?: { board: CinematicBoard; violations: string[] } }): Promise<PlannedBoard> {
  const seconds = o.seconds ?? 8;
  let violations: string[] = o.prior?.violations ?? [];
  let previous: CinematicBoard | undefined = o.prior?.board;
  let lastError: string | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    const p = boardPrompt({ ...o, seconds, violations, ...(previous ? { previous } : {}) });
    try {
      let reply: unknown;
      if (o.photo) {
        reply = await ctx.meta.spark.reviewImages([o.photo], `${p.system}\n\n${p.user}`);
      } else {
        reply = (await ctx.meta.spark.chat({ response_format: { type: 'json_object' }, temperature: 0.9, messages: [{ role: 'system', content: p.system }, { role: 'user', content: p.user }] })).content;
      }
      ctx.ledger.add(ctx.filmId, 'muse-spark-1.3-contributor', '1 call', o.photo ? 0.005 : 0.002);
      const parsed = parseBoard(reply);
      if (!parsed.ok) {
        violations = [`the reply could not be read: ${parsed.reason}`];
        continue;
      }
      // only a board that would break the film goes back to Muse once; an element dropped for safety is reported, not a reason to refuse the board
      const review = reviewBoard(parsed.board);
      violations = review.hard;
      previous = parsed.board;
      if (!violations.length) return { board: review.board, source: 'muse', violations: [], dropped: parsed.dropped };
    } catch (err) {
      // a failed call (a busy service, a reply cut short) is tried again once with the same prompt, not given up on
      violations = o.prior?.violations ?? [];
      lastError = `the call failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  return { board: floorBoard(o), source: 'floor', violations: lastError && !violations.length ? [lastError] : lastError ? [...violations, lastError] : violations, dropped: [] };
}
