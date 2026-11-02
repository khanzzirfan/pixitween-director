import type { Buffer } from 'node:buffer';
import { z } from 'zod';
import type { ToolCtx } from '@shared/tools';
import { referenceDeck } from './reference-deck';
import { CAMERA, MOVE_RULES, SHEET, TEXT_RULES, VOCAB } from './cinematic-rules';
import { SET_AIR, SET_HELP, SET_LOOKS, type BoardSet } from './set-art';
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
  /** The words on screen in this shot (a hook line, a feeling): never the price, the name or the brand, which land in the end hold. */
  text?: string;
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
  text: z.string().max(40).optional(),
  note: z.string().max(140).optional(),
});

/** The rules from the reference films: hook in the first beat, 0.4-2.5 s cuts, the last shot holds 12-37 % of the runtime, push-in leads. */
export const SHEET_RULES = SHEET;

/** How the product's ingredient kinds may be used: solids fall, burst, orbit or drift; cards splash or swirl. */
const ACTIONS_FOR: Record<IngredientUse, readonly IngredientAction[]> = { solid: ['fall', 'burst', 'orbit', 'drift'], card: ['splash', 'swirl'] };

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
  if (first && (first.move === 'whip' || first.move === 'rack')) v.push(`the first shot is the hook: push, orbit or truck, not ${first.move}`);
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
  // variety is the point of a moving camera: at least three kinds of move, each of the strong ones in moderation
  const kinds = new Set(bs.filter((b) => b.move !== 'hold').map((b) => b.move));
  if (kinds.size < MOVE_RULES.minKinds) v.push(`use at least ${MOVE_RULES.minKinds} different camera moves (got ${[...kinds].join(', ') || 'none'}); try a truck or a crane`);
  const texts = bs.map((b, i) => ({ b, i })).filter(({ b }) => b.text?.trim());
  if (texts.length > TEXT_RULES.maxShots) v.push(`at most ${TEXT_RULES.maxShots} shots carry text`);
  for (const { b, i } of texts) {
    const n = b.text!.trim().split(/\s+/).length;
    if (i === bs.length - 1) v.push('the last shot carries no text: the price, name and tagline land there');
    else if (sizes[i] === 'macro') v.push(`shot ${i + 1} is a label macro; keep words out of it so the label reads`);
    if (n > TEXT_RULES.maxWords) v.push(`shot ${i + 1}: at most ${TEXT_RULES.maxWords} words on screen (got ${n})`);
    else if (n > Math.max(TEXT_RULES.minWords, Math.floor(b.seconds * TEXT_RULES.wordsPerSecond))) v.push(`shot ${i + 1} lasts ${b.seconds} s: it can take only ${Math.max(TEXT_RULES.minWords, Math.floor(b.seconds * TEXT_RULES.wordsPerSecond))} words`);
    if (/[$€£¥₹]|\d/.test(b.text!)) v.push(`shot ${i + 1}: the price never goes in a shot's words; it lands in the end hold, and words carry no numbers`);
  }
  if (!kinds.has('truck') && !kinds.has('crane')) v.push('include a truck or a crane: the moves that slide the set past the product (parallax)');
  const count = (m: string) => bs.filter((b) => b.move === m).length;
  if (count('whip') > MOVE_RULES.whipMax) v.push(`use the whip at most ${MOVE_RULES.whipMax} times`);
  if (count('rack') > MOVE_RULES.rackMax) v.push('use the rack focus once');
  if (count('truck') > MOVE_RULES.truckMax) v.push(`use the truck at most ${MOVE_RULES.truckMax} times`);
  if (count('crane') > MOVE_RULES.craneMax) v.push(`use the crane at most ${MOVE_RULES.craneMax} times`);
  bs.forEach((b, i) => {
    if (b.move === 'whip' && (i === bs.length - 1 || b.seconds > MOVE_RULES.whipSeconds)) v.push(`shot ${i + 1} is a whip: it is a quick swing, at most ${MOVE_RULES.whipSeconds} s, and never the last shot`);
    if ((b.move === 'rack') && sizes[i] === 'macro') v.push(`shot ${i + 1}: the rack focus needs a wide, medium or close shot, not the macro`);
  });
  const dollies = bs.filter((b) => b.move === 'dolly-zoom').length;
  if (dollies > MOVE_RULES.dollyMax) v.push('use the dolly-zoom once');
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
      if (at < SHEET.peakFrom || at > SHEET.peakTo) v.push(`the peak shot starts at ${Math.round(at * 100)}% of the film; put it at ${Math.round(SHEET.peakFrom * 100)}-${Math.round(SHEET.peakTo * 100)}%`);
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
      { size: 'medium', move: 'truck', seconds: 0.9, angle: 'eye', phase: 'build', product: 'turn', cut: 'wipe', ...ing(land, land?.use === 'card' ? act(land, 'drift', 'splash') : 'burst'), note: 'the camera trucks sideways past the set while the can turns and an element splashes or bursts' },
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
  /** The world round the product: the backdrop and floor, and what hangs in the air. Absent means the plain dark field. */
  set?: BoardSet;
  /** The line under the name in the end hold, at most TEXT_RULES.taglineWords words. */
  tagline?: string;
  /** A live, hand-held tremor on the camera. Absent means on: a small sway is how a moving camera feels like a person holding it. */
  handheld?: boolean;
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
const boardJson = (b: CinematicBoard) => ({ concept: b.concept, mood: b.mood, ...(b.tone ? { tone: b.tone } : {}), ...(b.key ? { key: b.key } : {}), ...(b.set ? { set: b.set } : {}), ...(b.handheld !== undefined ? { handheld: b.handheld } : {}), ...(b.tagline ? { tagline: b.tagline } : {}), elements: b.elements, beats: b.sheet.beats });

/** The prompt that asks Muse (looking at the product photo) for a board. `violations` is set on the retry. */
export function boardPrompt(o: { title: string; brief?: string; brand?: string; category?: string; seconds: number; flat?: boolean; violations?: string[]; previous?: CinematicBoard }): { system: string; user: string } {
  const R = SHEET_RULES;
  return {
    system: [
      'You are the creative director of a short photoreal 3D product ad: the real product in a dark, moody world with real things around it, shot like the best drink and food commercials.',
      referenceDeck(`${o.category ?? ''} ${o.title}`),
      'YOUR TASK. You are shown the product photo. First find its ONE idea (a contrast or a device, as above) and write it as the concept. Then decide what belongs in the film, and write a shot list in which every shot has a reason (the note) that serves the idea. Vary the actions and the lengths of your shots; do not copy the worked boards. Reply with JSON only, in this shape:',
      `{"concept":"one sentence","mood":"a few words","tone":"warm|cool|neutral","key":"low|mid|high","set":{"look":"beach|pool|sunset|sky|studio|night|garden","air":"none|dust|bokeh|spray"},"handheld":true,"tagline":"at most ${TEXT_RULES.taglineWords} words","elements":[{"id":"slug","name":"what SAM should find","use":"solid|card","glass":false,"look":"one piece, concrete colours and materials","pieces":1,"sizeM":0.02}],"beats":[{"size","move","seconds","angle","phase","product","cut","ingredient":{"kind":"element id","action"},"text":"optional words on screen","note"}]}`,
      `THE SET. The product does not float in nothing: it stands in a place, with depth behind it, so the camera's moves slide the near and far apart (parallax). Pick the look that suits the idea and the campaign: ${SET_LOOKS.map((l) => `${l} (${SET_HELP[l]})`).join('; ')}. Pick the air: ${SET_AIR.join(', ')}; dust is fine specks drifting round the product, bokeh is big soft lights drifting near the lens (use it for warm, festive, night or dreamy films), spray is a burst of droplets in the peak shot (water, fizz, sea). Match the set to the light: a low key suits night or sunset, a high key suits beach, pool, sky or garden.`,
      `THE WORDS. Copy is part of the film. "tagline" is a line of at most ${TEXT_RULES.taglineWords} words that lands under the product name in the last shot (a feeling or a promise, not a slogan cliché). A shot's "text" is the words on screen in that shot, ${TEXT_RULES.minWords} to ${TEXT_RULES.maxWords} words, popped in one after another: a hook line on the first shot, a feeling or a benefit on one or two middle shots. Never the price, the product name or the brand (they land at the end by themselves), never in a macro or the last shot, at most ${TEXT_RULES.maxShots} shots with text, and a short shot takes fewer words (about ${TEXT_RULES.wordsPerSecond} words a second at most). Most shots have no text.`,
      'handheld is true for a live, hand-held sway on the camera (energetic, sport, summer, street, documentary: the default) and false for a calm, locked-off camera (premium, still, studio). CUTS: a cut should land while the camera is moving, so the shot before leaves at speed and the next enters at speed; the film does this for you, so do not put a hold in the middle of the film.',
      `tone and key set the light the film plays: tone is the colour of the key light, key is low (dark room, one bright object), mid or high (bright, airy). Pick them from the idea and the product's colours.`,
      `Every shot has all of: angle (${ANGLES.join(', ')}; camera height, a hold keeps the one before), phase (${PHASES.join(', ')}: the first shot is hook, the last is close, exactly one shot is peak at ${Math.round(SHEET.peakFrom * 100)}-${Math.round(SHEET.peakTo * 100)}% of the film, the dolly-zoom is the reveal), product (${PRODUCT_MOVES.join(', ')}: what the can does; drop-in once at most, still in the macro and in the last shot), cut (${CUTS.join(', ')}: how the shot starts; wipe dips to dark for a moment, cloud blooms light across the frame; use them where the world changes, at most two or three in the film). Two shots in a row must differ in size, angle or move. Vary the angles.`,
      'Write each note as what the camera, the product or the world DOES in that shot, using only the fields above; the film cannot play anything else (no match cuts, no liquid physics, no text effects).',
      `Elements: 2 to 4 real things that belong round THIS product, chosen from what you see: what it is made of, what it is used with, what it feels like (a coffee can: beans, ice, a milk splash; a lemon soda: lemon slices, ice, a fizz splash; a jar of honey: a dripping ribbon of honey, a flower). Never the product itself, people, hands, text, logos or brand names, and no more than ${MAX_ELEMENTS}.`,
      'use "solid" for a small physical object that can fall, fly or orbit (a bean, a slice, a leaf); glass:true for clear things drawn by the engine as glass (ice, sugar, droplets): they need no picture. use "card" for something flat and photographic that always faces the camera (a splash, a swirl, steam, smoke, powder); a card may be a sequence of 1 to 6 stages in "pieces" (a splash growing then falling). sizeM is metres: a solid 0.01-0.08, a card 0.15-0.5 (the product is 0.16 m tall). "look" describes one piece, or each stage in order.',
      `size is one of ${SHOT_SIZES.join(', ')}. move is one of ${MOVES.join(', ')}: ${MOVES.map((m) => `${m} = ${MOVE_HELP[m]}`).join('; ')}. A great film uses at least ${MOVE_RULES.minKinds} different moves and moves the world past the product (truck, crane, orbit), not only in on it. action is one of: ${ACTION_HELP}. A solid may fall, burst, orbit or drift; a card may only splash or swirl.`,
      `Shots: ${R.minBeats}-${R.maxBeats} shots, ${R.minTotal}-${R.maxTotal} s in all; the first shot is a hook of at most ${R.firstMax} s; every shot but the last lasts ${R.minBeat}-${R.maxBeat} s; the last shot is a hold of ${R.holdMin * 100}-${R.holdMax * 100}% of the film, with no element, where the price rests;`,
      'DIRECTOR\'S CRAFT. The client\'s brief may be short and cold; you are the director, so turn it into a film with a point of view: keep every fact it gives (price, claim, mood words, platform) and add what a great commercial adds: a clear idea, one consistent look (one light, one colour world, one lens language) from the first shot to the last, camera moves with intent (push to build desire, truck for the world streaming by, crane to rise on the scene, orbit to show form, whip for a quick cut, pull or rack to reveal, dolly-zoom once for the turn), ingredient action that echoes the product\'s story, rhythm that builds to one peak, and a quiet last hold where the price lands. Never contradict the brief.',
      'most moving shots push in; alternate sizes (never three of the same size in a row); include a macro on the label (no element in it) and at least one wide; use the dolly-zoom once, as the reveal, never first; give at least two shots an element, and use every element you list.',
    ].join('\n'),
    user: [...(o.brief?.trim() ? [`The client's brief, in their own words (take its facts, add your craft): ${o.brief.trim().slice(0, 600)}`] : []), `Product: ${o.title}${o.brand ? ` by ${o.brand}` : ''}${o.category ? ` (${o.category})` : ''}.`, `Aim for about ${o.seconds} seconds.`, ...(o.flat ? [`The product is a flat, thick cut-out of its photo (not a round pack): it can swing about ${CAMERA.flatSwingMax} degrees either way and drop in, but never turns right round, so the label macro is simply a close crop of its front.`] : []), ...(o.violations?.length ? ['Your last board broke these rules; fix them and keep everything else about it as it is:', ...o.violations.map((x) => `- ${x}`)] : []), ...(o.previous && o.violations?.length ? ['Your last board:', JSON.stringify(boardJson(o.previous))] : [])].join('\n'),
  };
}

const setSchema = z.object({ look: z.enum(SET_LOOKS), air: z.enum(SET_AIR).catch('none') });
const boardSchema = z.object({ concept: z.string().max(240).default(''), mood: z.string().max(80).default(''), set: setSchema.optional().catch(undefined), handheld: z.boolean().optional().catch(undefined), tagline: z.string().max(60).optional().catch(undefined), tone: z.enum(TONES).optional().catch(undefined), key: z.enum(KEY_LEVELS).optional().catch(undefined), elements: z.array(z.unknown()).max(8), beats: z.array(beatSchema).min(1).max(14) });

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
  return { ok: true, board: { concept: r.data.concept, mood: r.data.mood, ...(r.data.tone ? { tone: r.data.tone } : {}), ...(r.data.key ? { key: r.data.key } : {}), ...(r.data.set ? { set: r.data.set } : {}), ...(r.data.handheld !== undefined ? { handheld: r.data.handheld } : {}), ...(r.data.tagline?.trim() ? { tagline: r.data.tagline.trim().split(/\s+/).slice(0, TEXT_RULES.taglineWords).join(' ') } : {}), elements, sheet: { beats: r.data.beats.map((b) => ({ ...b, seconds: Math.round(b.seconds * 100) / 100 })) } }, dropped };
}

/** A board as it is kept (shots under `sheet`), read back from disk: undefined when it is not a board any more. Elements go through the safety pass again. */
export function readStoredBoard(raw: unknown): CinematicBoard | undefined {
  if (raw === null || typeof raw !== 'object') return undefined;
  const o = raw as { sheet?: { beats?: unknown } };
  const parsed = parseBoard({ ...(raw as object), beats: o.sheet?.beats });
  return parsed.ok ? parsed.board : undefined;
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
  return { concept: `${o.title}, the hero product with the things it is made of`, mood: 'dark, warm, glossy', set: floorSet(`${o.category ?? ''} ${o.title}`), elements, sheet: defaultBeatSheet(elements) };
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
export async function planBoard(ctx: ToolCtx, o: { title: string; brief?: string; brand?: string; category?: string; photo?: Buffer; seconds?: number; flat?: boolean; prior?: { board: CinematicBoard; violations: string[] } }): Promise<PlannedBoard> {
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
