import type { Buffer } from 'node:buffer';
import { z } from 'zod';
import type { ToolCtx } from '@shared/tools';
import { referenceDeck } from './reference-deck';
import { floorElements, sanitizeElements, MAX_ELEMENTS, type ElementSpec, type IngredientAction, type IngredientUse } from './ingredients';

// The cinematic board: what one 3D product film is made of (docs/direction/corpus/06-reference-films.md). Muse looks at the product photo and
// writes the board: a concept line, the elements that belong round this product (beans, a splash, a lemon slice...) and the shot list that uses
// them. A checker holds the shots to what the reference films do and every element to being used; the builder (cinematic-film.ts) plays the board
// as camera moves and element motions in one stage3d world. Pure except planBoard, which makes one Spark call (about $0.005).

export const SHOT_SIZES = ['wide', 'medium', 'close', 'macro'] as const;
/** push: the camera moves in, pull: out, hold: stays, orbit: swings round the product, dolly-zoom: the lens widens while the product holds its size. */
export const MOVES = ['push', 'pull', 'hold', 'orbit', 'dolly-zoom'] as const;
export const ACTIONS = ['fall', 'burst', 'orbit', 'drift', 'splash', 'swirl'] as const;
/** Camera height: low looks up at the product (power), eye is level, high looks down on it. */
export const ANGLES = ['low', 'eye', 'high'] as const;
/** Where the shot sits in the film's story; the checker holds the order and the sensory peak to the reference films. */
export const PHASES = ['hook', 'build', 'peak', 'reveal', 'close'] as const;
/** What the product does in the shot: still, turns, or drops in from above. */
export const PRODUCT_MOVES = ['still', 'turn', 'drop'] as const;
/** How the shot starts: hard cut, a wipe (a quick dip to dark) or a cloud (a bloom of light fills the frame). */
export const CUTS = ['hard', 'wipe', 'cloud'] as const;
export const TONES = ['warm', 'cool', 'neutral'] as const;
export const KEY_LEVELS = ['low', 'mid', 'high'] as const;
export type Tone = (typeof TONES)[number];
export type KeyLevel = (typeof KEY_LEVELS)[number];
export type ShotSize = (typeof SHOT_SIZES)[number];
export type Move = (typeof MOVES)[number];
export type Angle = (typeof ANGLES)[number];
export type Phase = (typeof PHASES)[number];
export type ProductMove = (typeof PRODUCT_MOVES)[number];
export type Cut = (typeof CUTS)[number];

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
  /** What the world does in this shot, from the product's ingredient set. */
  ingredient?: { kind: string; action: IngredientAction };
  /** One line a person can read on the board. */
  note?: string;
}
export interface BeatSheet {
  beats: Beat[];
}

const beatSchema = z.object({
  size: z.enum(SHOT_SIZES),
  move: z.enum(MOVES),
  seconds: z.number().positive().max(6),
  angle: z.enum(ANGLES).optional(),
  phase: z.enum(PHASES).optional(),
  product: z.enum(PRODUCT_MOVES).optional(),
  cut: z.enum(CUTS).optional(),
  ingredient: z.object({ kind: z.string().min(1).max(30), action: z.enum(ACTIONS) }).optional(),
  note: z.string().max(140).optional(),
});

/** The rules from the reference films: hook in the first beat, 0.4-2.5 s cuts, the last shot holds 12-37 % of the runtime, push-in leads. */
export const SHEET_RULES = { minTotal: 6, maxTotal: 12, minBeat: 0.4, maxBeat: 2.5, firstMax: 1.5, holdMin: 0.12, holdMax: 0.37, minBeats: 5, maxBeats: 10, pushShare: 0.5 } as const;

/** How the product's ingredient kinds may be used: solids fall, burst, orbit or drift; cards splash or swirl. */
const ACTIONS_FOR: Record<IngredientUse, readonly IngredientAction[]> = { solid: ['fall', 'burst', 'orbit', 'drift'], card: ['splash', 'swirl'] };

/** A hold continues the framing of the shot before, so the size a person sees is that shot's; every other move sets its own (a dolly-zoom holds the size it names). */
export const effectiveSizes = (sheet: BeatSheet): ShotSize[] => {
  const out: ShotSize[] = [];
  sheet.beats.forEach((b, i) => out.push(b.move === 'hold' ? (out[i - 1] ?? b.size) : b.size));
  return out;
};
/** The camera height each shot plays at: eye level unless named; a hold keeps the height of the shot before. */
export const effectiveAngles = (sheet: BeatSheet): Angle[] => {
  const out: Angle[] = [];
  sheet.beats.forEach((b, i) => out.push(b.move === 'hold' ? (out[i - 1] ?? b.angle ?? 'eye') : (b.angle ?? 'eye')));
  return out;
};
export const totalSeconds = (sheet: BeatSheet): number => Math.round(sheet.beats.reduce((s, b) => s + b.seconds, 0) * 100) / 100;

/** Every way the sheet breaks the rules, as sentences Muse can act on; empty when it passes. `elements` is the set the sheet may use. */
export function checkBeatSheet(sheet: BeatSheet, elements: readonly ElementSpec[]): string[] {
  const R = SHEET_RULES;
  const v: string[] = [];
  const bs = sheet.beats;
  const total = totalSeconds(sheet);
  if (bs.length < R.minBeats || bs.length > R.maxBeats) v.push(`use ${R.minBeats} to ${R.maxBeats} shots (got ${bs.length})`);
  if (total < R.minTotal || total > R.maxTotal) v.push(`the film must run ${R.minTotal} to ${R.maxTotal} seconds (got ${total})`);
  const sizes = effectiveSizes(sheet);
  const angles = effectiveAngles(sheet);
  bs.forEach((b, i) => {
    const last = i === bs.length - 1;
    if (!last && (b.seconds < R.minBeat || b.seconds > R.maxBeat)) v.push(`shot ${i + 1} lasts ${b.seconds} s; every shot but the last lasts ${R.minBeat} to ${R.maxBeat} s`);
    if (b.ingredient) {
      const def = elements.find((e) => e.id === b.ingredient!.kind);
      if (!def) v.push(`shot ${i + 1} uses "${b.ingredient.kind}", which is not one of the elements (${elements.map((e) => e.id).join(', ')})`);
      else if (!ACTIONS_FOR[def.use].includes(b.ingredient.action)) v.push(`shot ${i + 1}: a ${def.use} element ("${def.id}") can only ${ACTIONS_FOR[def.use].join(', ')}, not ${b.ingredient.action}`);
      if (sizes[i] === 'macro') v.push(`shot ${i + 1} is a label macro; keep elements out of it so the label reads`);
    }
  });
  const first = bs[0];
  if (first && first.seconds > R.firstMax) v.push(`the first shot is the hook: at most ${R.firstMax} s (got ${first.seconds})`);
  if (first && first.move === 'hold') v.push('the first shot must move (push, pull, orbit or dolly-zoom), not hold');
  const end = bs.at(-1);
  if (end) {
    if (end.move !== 'hold') v.push('the last shot must be a hold: the price and brand rest there');
    const share = total > 0 ? end.seconds / total : 0;
    if (share < R.holdMin || share > R.holdMax) v.push(`the end hold must be ${Math.round(R.holdMin * 100)}-${Math.round(R.holdMax * 100)}% of the film (it is ${Math.round(share * 100)}%)`);
    if (end.ingredient) v.push('keep the last shot clear of ingredients so the price reads');
  }
  // a hold is the same shot going on, so only the shots that set a size count toward a run
  const setters = sheet.beats.map((b, i) => ({ i, size: sizes[i] })).filter(({ i }) => sheet.beats[i]!.move !== 'hold');
  for (let k = 2; k < setters.length; k++) {
    if (setters[k]!.size === setters[k - 1]!.size && setters[k]!.size === setters[k - 2]!.size) v.push(`shots ${setters[k - 2]!.i + 1} to ${setters[k]!.i + 1} are all ${setters[k]!.size}; alternate the size`);
  }
  if (!sizes.includes('macro')) v.push('include a label macro shot (size macro)');
  if (!sizes.includes('wide')) v.push('include a wide shot');
  const movers = bs.filter((b) => b.move !== 'hold');
  const pushes = movers.filter((b) => b.move === 'push').length;
  if (movers.length && pushes / movers.length < R.pushShare) v.push(`push-in leads: at least ${Math.round(R.pushShare * 100)}% of the moving shots must be pushes (got ${pushes} of ${movers.length})`);
  const dollies = bs.filter((b) => b.move === 'dolly-zoom').length;
  if (dollies > 1) v.push('use the dolly-zoom once');
  if (bs[0]?.move === 'dolly-zoom') v.push('the dolly-zoom is the reveal, not the opener');
  if (bs.filter((b) => b.ingredient).length < 2) v.push('give at least two shots an element');
  // two shots in a row must differ in size, camera height or move, or they read as one shot with a jump
  for (let k = 1; k < bs.length; k++) {
    if (sizes[k] === sizes[k - 1] && angles[k] === angles[k - 1] && bs[k]!.move === bs[k - 1]!.move) v.push(`shots ${k} and ${k + 1} look the same (same size, height and move); change one`);
  }
  if (bs.some((b) => b.angle) && new Set(angles).size < 2) v.push('vary the camera height (angle) across the film');
  if (end?.product && end.product !== 'still') v.push('the product holds still in the last shot');
  if (bs.some((b) => b.phase)) {
    if (bs[0]!.phase !== 'hook') v.push('the first shot has the phase hook');
    if (end && end.phase !== 'close') v.push('the last shot has the phase close');
    const peaks = bs.map((b, i) => ({ b, i })).filter(({ b }) => b.phase === 'peak');
    if (peaks.length !== 1) v.push(`exactly one shot has the phase peak (the sensory high point; got ${peaks.length})`);
    else if (total > 0) {
      const at = bs.slice(0, peaks[0]!.i).reduce((x, b) => x + b.seconds, 0) / total;
      if (at < 0.35 || at > 0.8) v.push(`the peak shot starts at ${Math.round(at * 100)}% of the film; put it at 35-80%`);
    }
    if (bs.filter((b) => b.phase === 'reveal').length > 1) v.push('use the phase reveal once');
  }
  // an element no shot uses would be drawn for nothing
  for (const e of elements) if (!bs.some((b) => b.ingredient?.kind === e.id)) v.push(`the element "${e.id}" is never used; use it in a shot or leave it out`);
  return v;
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
  const flip = (e: ElementSpec) => e.use === 'card' && e.pieces > 1;
  const card = (e: ElementSpec) => e.use === 'card';
  const any = () => true;
  const ing = (e: ElementSpec | undefined, action: IngredientAction): Pick<Beat, 'ingredient'> => (e ? { ingredient: { kind: e.id, action } } : {});
  // each shot takes the element that suits it best; any kind can fill any shot, so up to five elements are all used
  const hook = take(solid, glass, card);
  const land = take(flip, card, solid, glass);
  const orbiter = take(glass, solid, card);
  const swirl = take(card, solid, glass);
  const floaty = take(any);
  const act = (e: ElementSpec | undefined, hookish: IngredientAction, prefer: IngredientAction) => (e && e.use === 'card' ? (hookish === 'fall' ? 'swirl' : prefer === 'splash' && e.pieces > 1 ? 'splash' : 'swirl') : hookish === 'fall' ? 'fall' : prefer);
  return {
    beats: [
      { size: 'wide', move: 'push', seconds: 1.0, angle: 'low', phase: 'hook', product: 'drop', ...ing(hook, act(hook, 'fall', 'fall')), note: 'hook: an element falls past the lens while the camera pushes in and the can drops in' },
      { size: 'medium', move: 'push', seconds: 0.9, angle: 'eye', phase: 'build', product: 'turn', cut: 'wipe', ...ing(land, land?.use === 'card' ? act(land, 'drift', 'splash') : 'burst'), note: 'the can turns as an element splashes or bursts' },
      { size: 'macro', move: 'push', seconds: 0.9, angle: 'eye', phase: 'build', product: 'still', note: 'label macro: push to the label, the can faces the lens' },
      { size: 'close', move: 'orbit', seconds: 1.1, angle: 'low', phase: 'build', product: 'still', ...ing(orbiter, orbiter?.use === 'card' ? 'swirl' : 'orbit'), note: 'the camera swings round while an element orbits' },
      { size: 'medium', move: 'push', seconds: 1.1, angle: 'high', phase: 'peak', product: 'still', cut: 'cloud', ...ing(swirl, swirl?.use === 'card' ? 'swirl' : 'drift'), note: 'sensory peak: an element wraps the can as the camera pushes in from above' },
      { size: 'medium', move: 'dolly-zoom', seconds: 1.0, angle: 'eye', phase: 'reveal', product: 'still', ...ing(floaty, floaty?.use === 'card' ? 'swirl' : 'drift'), note: 'reveal: the lens widens, the can holds its size' },
      { size: 'medium', move: 'hold', seconds: 2.0, phase: 'close', product: 'still', note: 'end hold: price and brand' },
    ],
  };
}

const ACTION_HELP = 'fall (solid elements drop through the frame), burst (solid elements fly outward), orbit (solid elements circle the product), drift (solid elements float), splash (a flat card that plays its stages), swirl (a flat card that drifts and rolls)';

/** The board Muse writes: what the film is about, the elements round the product, and the shots that use them. */
export interface CinematicBoard {
  concept: string;
  mood: string;
  /** The light the builder plays: warm or cool key colour, low-key (dark field, dim halo) or high-key (bright field). Absent means the product's own colour at medium key. */
  tone?: Tone;
  key?: KeyLevel;
  elements: ElementSpec[];
  sheet: BeatSheet;
}

/** A board in the shape Muse writes it (beats at the top). */
const boardJson = (b: CinematicBoard) => ({ concept: b.concept, mood: b.mood, ...(b.tone ? { tone: b.tone } : {}), ...(b.key ? { key: b.key } : {}), elements: b.elements, beats: b.sheet.beats });

/** The prompt that asks Muse (looking at the product photo) for a board. `violations` is set on the retry. */
export function boardPrompt(o: { title: string; brand?: string; category?: string; seconds: number; violations?: string[]; previous?: CinematicBoard }): { system: string; user: string } {
  const R = SHEET_RULES;
  return {
    system: [
      'You are the creative director of a short photoreal 3D product ad: the real product in a dark, moody world with real things around it, shot like the best drink and food commercials.',
      referenceDeck(`${o.category ?? ''} ${o.title}`),
      'YOUR TASK. You are shown the product photo. First find its ONE idea (a contrast or a device, as above) and write it as the concept. Then decide what belongs in the film, and write a shot list in which every shot has a reason (the note) that serves the idea. Vary the actions and the lengths of your shots; do not copy the worked boards. Reply with JSON only, in this shape:',
      '{"concept":"one sentence","mood":"a few words","tone":"warm|cool|neutral","key":"low|mid|high","elements":[{"id":"slug","name":"what SAM should find","use":"solid|card","glass":false,"look":"one piece, concrete colours and materials","pieces":1,"sizeM":0.02}],"beats":[{"size","move","seconds","angle","phase","product","cut","ingredient":{"kind":"element id","action"},"note"}]}',
      `tone and key set the light the film plays: tone is the colour of the key light, key is low (dark room, one bright object), mid or high (bright, airy). Pick them from the idea and the product's colours.`,
      `Every shot has all of: angle (${ANGLES.join(', ')}; camera height, a hold keeps the one before), phase (${PHASES.join(', ')}: the first shot is hook, the last is close, exactly one shot is peak at 35-80% of the film, the dolly-zoom is the reveal), product (${PRODUCT_MOVES.join(', ')}: what the can does; drop-in once at most, still in the macro and in the last shot), cut (${CUTS.join(', ')}: how the shot starts; wipe dips to dark for a moment, cloud blooms light across the frame; use them where the world changes, at most two or three in the film). Two shots in a row must differ in size, angle or move. Vary the angles.`,
      'Write each note as what the camera, the product or the world DOES in that shot, using only the fields above; the film cannot play anything else (no match cuts, no liquid physics, no text effects).',
      `Elements: 2 to 4 real things that belong round THIS product, chosen from what you see: what it is made of, what it is used with, what it feels like (a coffee can: beans, ice, a milk splash; a lemon soda: lemon slices, ice, a fizz splash; a jar of honey: a dripping ribbon of honey, a flower). Never the product itself, people, hands, text, logos or brand names, and no more than ${MAX_ELEMENTS}.`,
      'use "solid" for a small physical object that can fall, fly or orbit (a bean, a slice, a leaf); glass:true for clear things drawn by the engine as glass (ice, sugar, droplets): they need no picture. use "card" for something flat and photographic that always faces the camera (a splash, a swirl, steam, smoke, powder); a card may be a sequence of 1 to 6 stages in "pieces" (a splash growing then falling). sizeM is metres: a solid 0.01-0.08, a card 0.15-0.5 (the product is 0.16 m tall). "look" describes one piece, or each stage in order.',
      `size is one of ${SHOT_SIZES.join(', ')}. move is one of ${MOVES.join(', ')}. action is one of: ${ACTION_HELP}. A solid may fall, burst, orbit or drift; a card may only splash or swirl.`,
      `Shots: ${R.minBeats}-${R.maxBeats} shots, ${R.minTotal}-${R.maxTotal} s in all; the first shot is a hook of at most ${R.firstMax} s; every shot but the last lasts ${R.minBeat}-${R.maxBeat} s; the last shot is a hold of ${R.holdMin * 100}-${R.holdMax * 100}% of the film, with no element, where the price rests;`,
      'most moving shots push in; alternate sizes (never three of the same size in a row); include a macro on the label (no element in it) and at least one wide; use the dolly-zoom once, as the reveal, never first; give at least two shots an element, and use every element you list.',
    ].join('\n'),
    user: [`Product: ${o.title}${o.brand ? ` by ${o.brand}` : ''}${o.category ? ` (${o.category})` : ''}.`, `Aim for about ${o.seconds} seconds.`, ...(o.violations?.length ? ['Your last board broke these rules; fix them and keep everything else about it as it is:', ...o.violations.map((x) => `- ${x}`)] : []), ...(o.previous && o.violations?.length ? ['Your last board:', JSON.stringify(boardJson(o.previous))] : [])].join('\n'),
  };
}

const boardSchema = z.object({ concept: z.string().max(240).default(''), mood: z.string().max(80).default(''), tone: z.enum(TONES).optional().catch(undefined), key: z.enum(KEY_LEVELS).optional().catch(undefined), elements: z.array(z.unknown()).max(8), beats: z.array(beatSchema).min(1).max(14) });

/** Models write `null` for "none" ("ingredient": null); the schema wants the field absent, so every null is removed before parsing. */
function stripNulls(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripNulls);
  if (v !== null && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null).map(([k, x]) => [k, stripNulls(x)]));
  return v;
}

/** The board in a Spark reply (an object or JSON text), or why it could not be read. Elements that fail the safety pass are listed in `dropped`. */
export function parseBoard(raw: unknown): { ok: true; board: CinematicBoard; dropped: string[] } | { ok: false; reason: string } {
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
  return { ok: true, board: { concept: r.data.concept, mood: r.data.mood, ...(r.data.tone ? { tone: r.data.tone } : {}), ...(r.data.key ? { key: r.data.key } : {}), elements, sheet: { beats: r.data.beats.map((b) => ({ ...b, seconds: Math.round(b.seconds * 100) / 100 })) } }, dropped };
}

export interface PlannedBoard {
  board: CinematicBoard;
  /** muse: the board came from Spark looking at the photo and passed the checker; floor: Spark failed twice or was not asked, so the floor library and floor sheet were used. */
  source: 'muse' | 'floor';
  /** Rule breaks left over from the last Muse attempt (empty when source is muse). */
  violations: string[];
  /** Elements Muse proposed that were dropped, with the reason. */
  dropped: string[];
}

/** The floor board: the floor library's elements for the product's words and the floor sheet. */
export function floorBoard(o: { title: string; category?: string }): CinematicBoard {
  const elements = floorElements(o.title, o.category);
  return { concept: `${o.title}, the hero product with the things it is made of`, mood: 'dark, warm, glossy', elements, sheet: defaultBeatSheet(elements) };
}

/** Rule breaks in a board as it is: its elements through the safety pass and its shots through the checker. Used on boards read back from disk, which a person may have edited. */
export function reviewBoard(board: CinematicBoard): { board: CinematicBoard; violations: string[]; dropped: string[] } {
  const { elements, dropped } = sanitizeElements(board.elements);
  const next = { ...board, elements };
  return { board: next, dropped, violations: [...(elements.length ? [] : ['list 2 to 4 elements']), ...checkBeatSheet(next.sheet, elements), ...dropped.map((d) => `element dropped: ${d}`)] };
}

/**
 * Asks Muse (Spark vision) for the board: the product photo and a short brief in, concept, elements and shots out. Once more with the broken
 * rules AND the board that broke them when the first fails the checker (so Muse mends it instead of starting over), else the floor board. About
 * $0.005 a call. Without a photo it asks with the words alone. `prior` starts from a board already known (a saved one that fails the checker).
 */
export async function planBoard(ctx: ToolCtx, o: { title: string; brand?: string; category?: string; photo?: Buffer; seconds?: number; prior?: { board: CinematicBoard; violations: string[] } }): Promise<PlannedBoard> {
  const seconds = o.seconds ?? 8;
  let violations: string[] = o.prior?.violations ?? [];
  let previous: CinematicBoard | undefined = o.prior?.board;
  let dropped: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const p = boardPrompt({ ...o, seconds, violations, ...(previous ? { previous } : {}) });
    try {
      let reply: unknown;
      if (o.photo) {
        reply = await ctx.meta.spark.reviewImages([o.photo], `${p.system}\n\n${p.user}`);
      } else {
        reply = (await ctx.meta.spark.chat({ response_format: { type: 'json_object' }, temperature: 0.7, messages: [{ role: 'system', content: p.system }, { role: 'user', content: p.user }] })).content;
      }
      ctx.ledger.add(ctx.filmId, 'muse-spark-1.3-contributor', '1 call', o.photo ? 0.005 : 0.002);
      const parsed = parseBoard(reply);
      if (!parsed.ok) {
        violations = [`the reply could not be read: ${parsed.reason}`];
        continue;
      }
      const review = reviewBoard(parsed.board);
      dropped = parsed.dropped;
      violations = review.violations.concat(dropped.filter((d) => !review.violations.some((x) => x.endsWith(d))).map((d) => `element dropped: ${d}`));
      previous = parsed.board;
      if (!violations.length) return { board: review.board, source: 'muse', violations: [], dropped };
    } catch (err) {
      violations = [`the call failed: ${err instanceof Error ? err.message : String(err)}`];
      break;
    }
  }
  return { board: floorBoard(o), source: 'floor', violations, dropped };
}
