// The rule book of a cinematic film: every number the corpus gave us and every word Muse may use, in one place. The board prompt teaches Muse
// from it, the checker holds Muse's board to it, the camera and the copy are built from it, the motion check judges the rendered film by it, and
// docs/architecture/cinematic-rules.md is written from it (scripts/gen-cinematic-rules.ts; a test fails when the file is out of date). Change a
// rule here and all of them change together.
//
// Sources: docs/misc/direction/corpus (craft.md, principles.md, 06-reference-films.md) and the reference ads measured shot by shot.

/** What a film is made of: the vocabulary of a board, one line each. Muse may use only these words. */
export const VOCAB = {
  sizes: {
    wide: 'the product small in its world',
    medium: 'the product at ease in the frame',
    close: 'the product fills most of the frame',
    macro: 'a crop of the label, the frame full of it',
  },
  moves: {
    push: 'the camera moves in on the product',
    pull: 'the camera moves out',
    hold: 'the camera stays and drifts (the end shot, or a beat of calm)',
    orbit: 'the camera swings round the product on an arc (shows its form)',
    truck: 'the camera slides sideways past the set, the product staying centred: the world streams by (parallax)',
    crane: 'the camera rises or falls while looking at the product (reveals the world)',
    whip: 'a fast swing that brakes into the frame, for a quick cut (best in a short shot)',
    rack: 'the focus moves from the soft near lights to the product while the camera creeps in (dreamy)',
    'dolly-zoom': 'the lens widens while the product holds its size (the background stretches away)',
  },
  angles: { low: 'looks up at the product (power)', eye: 'level (the label and the reveal)', high: 'looks down on it (the sensory peak)' },
  phases: { hook: 'the first shot: already moving', build: 'the middle', peak: 'the sensory high point', reveal: 'the dolly-zoom', close: 'the last shot: the price rests' },
  productMoves: { still: 'holds still', turn: 'turns on', drop: 'drops in from above' },
  cuts: {
    hard: 'a plain cut',
    wipe: 'a quick dip to dark across the cut',
    cloud: 'a bloom of light across the cut',
    zoom: 'a zoom blur: the lens rushes through the cut',
    whip: 'a whip pan: a fast sideways smear into the next shot',
    ripple: 'a water drop ripple spreads across the cut',
    swirl: 'a swirl twists the old shot into the new',
    glitch: 'a digital glitch tears the picture across the cut',
    burn: 'a warm film burn washes through the cut',
    streak: 'light streaks sweep across the cut',
    flash: 'a hot flash of the key light that fades at once (inside the scene)',
    pass: 'the product passes the lens: the shot before plunges at it until it fills the frame and this shot pulls out of that crop (inside the scene)',
    match: 'a match cut on shape: this shot opens with the product as large and on the lens the last one ended on, the angle jumping (inside the scene)',
  },
  actions: { fall: 'drop through the frame', burst: 'fly outward', orbit: 'circle the product', drift: 'float (a liquid floats round the product as wobbling drops)', splash: 'a liquid crowns up round the product and breaks into drops (a card plays its stages)', swirl: 'a liquid winds round the product in a spiral ribbon (a card drifts and rolls)', pour: 'a liquid falls in a stream beside the product into a pool', rise: 'a vapour rises in soft wisps behind the product', wrap: 'a vapour rolls round the product as a cloud and clears' },
  looks: {
    beach: 'blue sky over a bright sea, sand underfoot (summer, swim, surf, holiday)',
    pool: 'sunlit aqua water all round, light dancing in it (swim, cool drinks, fresh)',
    sunset: 'a purple to orange dusk sky with a low glowing sun, dark ground (evening, warm, romantic)',
    sky: 'open blue sky with soft clouds, a pale floor like cloud (light, air, travel)',
    studio: 'a clean soft grey sweep, no place (tech, tools, neutral products)',
    night: 'a deep blue night with stars, dark ground (premium, bold, one bright object)',
    garden: 'green foliage out of focus, grass underfoot (natural, food, home)',
  },
  air: {
    none: 'clear air',
    dust: 'fine specks drifting round the product',
    bokeh: 'big soft lights drifting near the lens (warm, festive, night, dreamy)',
    spray: 'a burst of droplets in the peak shot (water, fizz, sea)',
    smoke: 'slow smoke drifting up behind the product the whole film (oud, incense, whisky, cigars, night, mystery)',
  },
} as const;

/** The shot list: how long, how many, how it is paced (the reference ads, measured). */
export const SHEET = {
  /** Only what the render needs: Muse decides the rest (how many shots, what order, which moves, where the peak sits). */
  minTotal: 4,
  maxTotal: 20,
  minBeats: 3,
  maxBeats: 14,
  /** every shot but the last */
  minBeat: 0.25,
  maxBeat: 6,
  /** the last shot's share of the film: long enough to read the price, short enough to be an ending */
  holdMin: 0.1,
  holdMax: 0.5,
} as const;

/** The words on screen. */
export const TEXT_RULES = {
  maxShots: 2,
  maxWords: 4,
  /** a shot can say about this many words a second, and always at least `minWords` */
  wordsPerSecond: 3,
  minWords: 2,
  taglineWords: 4,
  /** the end card says at most this many things: with a tagline it is the name, the tagline and the price (the brand was in the opening); without, the brand, the name and the price */
  endCardItems: 3,
} as const;

/** The camera's numbers (metres, degrees, shares). */
/** One light recipe for one key level of the board. */
export interface LightRecipe {
  /** the key's strength: the studio preset's 3.2 is raised so the lit side is clearly brighter than the shade side */
  key: number;
  /** fill and ambient: low, so the shade side keeps its shape */
  fill: number;
  ambient: number;
  /** the rim while the product lands and turns, and in the end hold */
  rim: number;
  rimEnd: number;
  /** the backdrop's corners darken by this much (0 none), so the eye goes to the centre where the product is */
  vignette: number;
}

/**
 * The light of a set, taken from the reference ads: one strong key from one side, a rim that outlines the product, little fill, so the product
 * is the brightest, most contrasty thing in the frame and its edges glint. (The studio preset's fill of 1.1 flattens a product into its beach.)
 * It follows the board's key level: a low key stays moody (less fill, a dark vignette), a high key is open and bright.
 */
export const LIGHT = {
  low: { key: 3.4, fill: 0.2, ambient: 0.05, rim: 1.8, rimEnd: 2.6, vignette: 0.45 } satisfies LightRecipe,
  mid: { key: 4, fill: 0.35, ambient: 0.1, rim: 1.5, rimEnd: 2.4, vignette: 0.3 } satisfies LightRecipe,
  high: { key: 4, fill: 0.6, ambient: 0.2, rim: 1.2, rimEnd: 2, vignette: 0.18 } satisfies LightRecipe,
  /** the cut-out's side face is lifted toward white by this share, so the thin edge is not a black outline */
  sideLift: 0.4,
  /** the contact shadow under the product: darker than the default so it sits on the floor */
  shadow: 0.6,
  /** a set's exposure is scaled by this: the stronger key would otherwise burn the floor to cream */
  exposure: 0.85,
} as const;

/**
 * The shader transitions a cut can use: the word the board writes, the open gl-transitions shader behind it, and how long it plays (it starts on the
 * first frame of the shot it leads into). Each costs a second render of the world for its length, so a film uses at most `max` of them.
 */
export const CUT_SHADERS = {
  zoom: { shader: 'CrossZoom', seconds: 0.4 },
  whip: { shader: 'WhipPan', seconds: 0.3 },
  ripple: { shader: 'WaterDrop', seconds: 0.5 },
  swirl: { shader: 'Swirl', seconds: 0.5 },
  glitch: { shader: 'GlitchDisplace', seconds: 0.35 },
  burn: { shader: 'FilmBurn', seconds: 0.6 },
  streak: { shader: 'LightStreaks', seconds: 0.5 },
  max: 3,
} as const;

/**
 * The finish: screen effects over the rendered world, how a commercial is graded. Muse picks a level for each from the idea (a low-key night
 * film wants a strong glow and a heavy vignette, a bright airy one almost none); the numbers behind the words are here. Bloom is on the world's
 * bright things (a halo behind the can, a hot rim) and swells a little when the end hold starts; grain is fine film noise; fringe is a slight
 * colour split at the edges, used on or off.
 */
export const FINISH = {
  glow: { soft: { intensity: 0.55, threshold: 0.72 }, strong: { intensity: 1.1, threshold: 0.55 } },
  grain: { fine: 0.07, heavy: 0.15 },
  vignette: { soft: 0.35, strong: 0.62 },
  fringe: 0.0007,
  /** the glow grows to this multiple of itself when the end hold starts */
  holdSwell: 1.35,
  /** the floor's shine: how strong the reflection is under the product, and the distance in metres at which it has faded away */
  floor: { matte: { strength: 0.2, fade: 0.3 }, glossy: { strength: 0.42, fade: 0.4 }, mirror: { strength: 0.65, fade: 0.55 } },
  /** beads of water on the product (a cold can): how soaked, 0 to 1 */
  wet: { light: 0.4, heavy: 0.9 },
  /** light rippling on the floor (a drink, water, a pool): how bright, how far from the product it fades, and ripples per metre */
  caustics: { soft: 0.35, bright: 0.7, fade: 0.3, scale: 40 },
} as const;
export const FINISH_LEVELS = { glow: ['none', 'soft', 'strong'], grain: ['none', 'fine', 'heavy'], vignette: ['none', 'soft', 'strong'], floor: ['none', 'matte', 'glossy', 'mirror'], wet: ['none', 'light', 'heavy'], caustics: ['none', 'soft', 'bright'] } as const;

/** How the small things in the air look. Ice is a clear cube with soft melted corners and a wet shine; a drop is a clear ball. */
export const MATERIALS = {
  /** ice: corner radius as a share of the shortest side (0 sharp, 0.5 a ball) */
  iceRound: 0.22,
  ice: { color: '#d8f1ff', roughness: 0.12, transmission: 1, ior: 1.31, thickness: 0.05, clearcoat: 1 },
  /** spray: a drop is a ball (round 0.5), clear and wet, never a cream cube */
  dropRound: 0.5,
  drop: { color: '#eaf7ff', roughness: 0.04, metalness: 0, opacity: 0.8, clearcoat: 1 },
} as const;

/**
 * The product's surface, chosen by Muse from the photo. The photo carries the colour; the surface only says how light sits on it. Metal mirrors the
 * set and tints a printed pack the set's colour (a cream can turned gold), so it is for bare metal seen in the photo; satin, the default, keeps the
 * photo's own colours.
 */
export const SURFACES = {
  matte: { roughness: 0.8, metalness: 0, clearcoat: 0 },
  satin: { roughness: 0.5, metalness: 0.05, clearcoat: 0.25 },
  gloss: { roughness: 0.22, metalness: 0, clearcoat: 0.9 },
  metal: { roughness: 0.3, metalness: 0.6, clearcoat: 0.8 },
} as const;
export type Surface = keyof typeof SURFACES;
export const SURFACE_NAMES = Object.keys(SURFACES) as Surface[];

export const CAMERA = {
  /** a push starts this many times further than it arrives: the hook comes in hard (the references push 40-90 %), later pushes ease in */
  pushFromHook: 1.7,
  pushFromLater: 1.3,
  /** a push in a wide shot dives harder: the product is small in a big world, and a 30 % push barely changes the picture (the motion check found it) */
  pushFromWide: 1.9,
  /** the floor's width and depth, metres: the hook's camera starts far back (further than the old 6 m the floor reached toward it), and the floor must still fill the bottom of the frame */
  groundSize: [16, 30],
  /** a hold starts this many times further than it ends and creeps in; the end card is never a still picture (the motion check wants the hold alive) */
  holdCreep: 1.35,
  /** the camera never goes lower than this above the floor, metres: a single-sided floor seen from below (a low angle far back) is not drawn, and the bottom of the frame shows the empty field */
  minCameraHeight: 0.03,
  /** the product drops in from this high above its place, metres: it is in the frame from the first picture (the old 0.6 m left the first frame empty) */
  dropFrom: 0.3,
  /** a truck slides this share of the distance either side */
  truckShare: 0.3,
  /** a whip starts this many degrees round */
  whipAzimuth: 55,
  /** the tremor, as a share of the camera's distance (about one percent of the frame's height) */
  shakeAmount: 0.007,
  /** the most tremor keys a shot may take */
  shakeKeysMax: 3,
  /** A shot with a speed ramp is sampled along its curve at this many keys between its ends (each costs a tween). */
  rampKeys: 5,
  /** a layer may hold 64 tweens; the tremor must leave room for everything else */
  tweenBudget: 190,
  /** How far behind the product the lens focuses when it pulls to the far set, in metres (the wall's distance). */
  farFocus: 3.2,
  /** A pass cut ends the shot before it by plunging at the product until it fills this much of the frame's height (a crop of its surface)... */
  passFill: 3,
  /** ...over the last share of that shot. */
  passTail: 0.28,
  /** the speed a cut leaves and enters at, as a share of the shot's mean speed: never from a stop */
  minCutSpeed: 0.5,
  /** with a set, a high camera looks down this many degrees: steeper and the frame holds only floor, the horizon and the sea leave it */
  highAngleSet: 14,
  /** the most a glass piece (ice, a droplet) measures, metres: bigger and a close camera sees a wall of see-through shards */
  glassMax: 0.018,
  /** a burst's direction toward the lens (negative: away from it) and its spread, degrees: it flies up and away, never into the lens */
  burstToward: -0.6,
  burstSpread: 40,
  /** the most a flat cut-out may turn either way, degrees: it shows only its front */
  flatSwingMax: 30,
  /** the end hold's product stands at most this share of the frame's height, so the name and tagline above it and the price beside it have room */
  maxHoldHeight: 0.56,
  /** the most a wide product may fill of the frame's width */
  maxWidthShare: 0.9,
  fovBase: 30,
  fovWide: 80,
} as const;

/** The motion check: what rendered frames must show (server/authoring/motion-check.ts). */
export const MOTION_RULES = {
  /** the sampling step, seconds */
  stepSec: 0.1,
  /** a moving shot's median step changes at least this share of the picture */
  /** set from measurement: on the five surf films the calmest moving shot changed 0.49 % a step and the rest 1.3 % or more, while the old frozen 2D hold changed 0.00 % */
  minShot: 0.004,
  /** the price hold may be calmer */
  minHold: 0.002,
  /** at least this share of the film must move */
  minLive: 0.85,
} as const;

/** The rules a person reads, one sentence each, with their numbers. The docs and the tests are made from these. */
export function ruleSentences(): string[] {
  const S = SHEET;
  const T = TEXT_RULES;
  const C = CAMERA;
  const L = LIGHT.mid;
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  return [
    `A film is ${S.minBeats} to ${S.maxBeats} shots and ${S.minTotal} to ${S.maxTotal} s in all.`,
    `The floor is ${C.groundSize[0]} by ${C.groundSize[1]} m so it fills the bottom of the frame when the hook's camera starts far back, and the product drops in from ${C.dropFrom * 100} cm, so the very first picture has the product in it.`,
    `The camera stays at least ${C.minCameraHeight * 100} cm above the floor, even at a low angle, so the floor is never seen from below.`,
    `Every shot but the last lasts ${S.minBeat} to ${S.maxBeat} s.`,
    `The last shot is a hold of ${pct(S.holdMin)} to ${pct(S.holdMax)} of the film, with no element and no words: the price, name and tagline land there.`,
    `Everything else about the shots is Muse's: how many, in what order, which moves, how long, where the peak sits. A move is only a preset (push starts ${C.pushFromLater} times further out, ${C.pushFromWide} in a wide shot, ${C.pushFromHook} in the hook); Muse can write a shot's camera out (fill, height, around, lens, side, ease, focus) and the numbers win. On a flat cut-out the macro's camera is aimed at the label: the spot of the picture with the most small sharp detail (a logo, printed text), kept inside the product.`,
    `The set's colours and the end card's style are Muse's: any #rrggbb for the sky, horizon, floor, glow, sea band and texture colour (set.palette over the look's own recipe), and an end card of a pill, bar or no plate, a disc, tag or plain price, centred or left, as written or in capitals, light to bold, in any accent. A palette colour that is not #rrggbb is dropped.`,
    `A cut lands while the camera is moving: the shot before leaves, and the shot after enters, at at least ${pct(C.minCutSpeed)} of its mean speed (a hold and the end of a whip are exempt).`,
    `The tremor is ${pct(C.shakeAmount)} of the camera distance, at most ${C.shakeKeysMax} keys a shot, and is dropped when the world's ${C.tweenBudget}-tween budget has no room.`,
    `The product's motion, the light and the shutter are Muse's: a shot's spin is up to two full turns either way, with a lean up to 40 degrees, a roll up to 30 and a toss up to two product heights at the middle of the shot; a shot's light slides the key between any two directions, sets its height (5 to 85 degrees) and its strength and the rim's strength (up to 2.5 and 3 times the film's); the key and rim colours are any #rrggbb; and the shutter is 0 to 1 of a frame's time, per film or per shot, drawn as 4 to 10 pictures averaged in an exact export. Light keys count in the world's ${C.tweenBudget}-tween budget, so the tremor gives way to them. Nothing is on unless Muse writes it.`,
    `The colour grade is Muse's: exposure, contrast, saturation and hue, split-toning tints (any #rrggbb) with a strength and a balance, a horizontal lens streak, halation (a soft glow round the highlights) and a letterbox of 1.85 to 2.6 whose bars stop at 30% of the frame's height and lift for the end hold.`,
    `The camera's path may pass through up to 3 waypoints (a smooth curve through them, sampled at 2 keys a waypoint plus 2); the tremor can be written out (amount 0 to 3 times the usual, 1 to 6 keys a shot, a seed) and set per shot (0 locks the shot); a focus pull runs between the near things, the product and the far set (${C.farFocus} m behind the product), with an aperture of 0 to 1 per shot or per film and bokeh of 0 to 1 that lets bright points spread into discs.`,
    `A shot's speed ramp is a curve of up to 5 points (rate 0.05 to 4 times normal); the shot keeps its length and its end, so cuts do not move. The camera and the product's spin are sampled along it at ${C.rampKeys} keys between the ends (counted in the tween budget) and the world's own motion runs on the same curve.`,
    `At most ${T.maxShots} shots carry words, each ${T.minWords} to ${T.maxWords} words and about ${T.wordsPerSecond} words a second at most; never a price or a number; the tagline is at most ${T.taglineWords} words. The end card says at most ${T.endCardItems} things: with a tagline the name, the tagline and the price, without one the brand, the name and the price.`,
    `With a set the high camera looks down ${C.highAngleSet} degrees, so the horizon and the sea stay in the frame; a glass piece is at most ${C.glassMax * 100} cm, and a burst flies up and away from the lens. Ice is a clear cube with its corners rounded to ${pct(MATERIALS.iceRound)} of its side and a wet shine; spray is clear round drops, never cubes.`,
    `A set is lit like the reference ads, by the board's key level: a mid key is one key at ${L.key}, a rim of ${L.rim} (${L.rimEnd} in the end hold) that outlines the product, fill ${L.fill}; a low key keeps the mood (key ${LIGHT.low.key}, fill ${LIGHT.low.fill}, a ${pct(LIGHT.low.vignette)} vignette) and a high key opens up (fill ${LIGHT.high.fill}). The cut-out's side face is lifted ${pct(LIGHT.sideLift)} toward white so no black outline shows, and the backdrop's horizon is never near white.`,
    `In the end hold the product stands at most ${pct(C.maxHoldHeight)} of the frame's height (the shot before it, whose framing the hold keeps, is held to the same), so the name, tagline and price never sit on it.`,
    `A flat, wide product never fills more than ${pct(C.maxWidthShare)} of the frame's width, and a flat cut-out is built as a solid body, so it turns as far as the spin says.`,
    `A cut may play a shader transition (${Object.keys(CUT_SHADERS).filter((k) => k !== 'max').join(', ')}); at most ${CUT_SHADERS.max} cuts in a film are anything but a plain cut, and never the first shot's.`,
    `Three cuts happen inside the scene and cost no second render, so they are not counted in that limit: flash (a hot flash of the key light that fades in 0.14 s), pass (the shot before plunges at the product over its last ${pct(C.passTail)} until the product fills the frame, and this shot pulls out of that crop) and match (this shot starts as close and on the same lens as the one before ended, so the product keeps its size and place while the angle jumps).`,
    `The finish is the screen grade over the world: glow (${FINISH.glow.soft.intensity} soft, ${FINISH.glow.strong.intensity} strong; it swells ${pct(FINISH.holdSwell - 1)} in the end hold), grain (${FINISH.grain.fine} fine, ${FINISH.grain.heavy} heavy), vignette (${FINISH.vignette.soft} soft, ${FINISH.vignette.strong} strong), an optional colour fringe of ${FINISH.fringe} and the floor's shine (a reflection of the product, ${FINISH.floor.matte.strength} matte, ${FINISH.floor.glossy.strength} glossy, ${FINISH.floor.mirror.strength} mirror, fading out ${FINISH.floor.matte.fade} to ${FINISH.floor.mirror.fade} m from it; only on a set) and wet (beads of condensation on the product, ${FINISH.wet.light} light, ${FINISH.wet.heavy} heavy, for a cold drink or a fresh, dewy product) and caustics (light rippling on the floor round the product the way a glass of liquid or a pool throws it, ${FINISH.caustics.soft} soft, ${FINISH.caustics.bright} bright, for drinks, water and anything fresh or aquatic; only on a set); the board picks the levels, and a board that picks none gets them from its key level.`,
    `The rendered film must move: a moving shot's picture changes at least ${(MOTION_RULES.minShot * 100).toFixed(2)}% a step (${MOTION_RULES.stepSec} s), the price hold at least ${(MOTION_RULES.minHold * 100).toFixed(2)}%, and at least ${pct(MOTION_RULES.minLive)} of the film is live.`,
  ];
}

/** The rule book as a markdown page. Written to docs/architecture/cinematic-rules.md by scripts/gen-cinematic-rules.ts. */
export function rulesMarkdown(): string {
  const table = (title: string, rows: Record<string, string>) => [`### ${title}`, '', '| word | meaning |', '|---|---|', ...Object.entries(rows).map(([k, v]) => `| \`${k}\` | ${v} |`), ''].join('\n');
  return [
    '# Cinematic rules',
    '',
    'Generated from `server/authoring/cinematic-rules.ts`: do not edit by hand. Run `npx tsx scripts/gen-cinematic-rules.ts`.',
    '',
    'The board prompt offers Muse the options in this book, the checker only catches what would break the film, and the motion check judges the rendered film by it.',
    '',
    '## The rules',
    '',
    ...ruleSentences().map((s) => `- ${s}`),
    '',
    '## The vocabulary',
    '',
    table('Shot sizes', VOCAB.sizes),
    table('Camera moves', VOCAB.moves),
    table('Camera heights', VOCAB.angles),
    table('Phases', VOCAB.phases),
    table('What the product does', VOCAB.productMoves),
    table('How a shot starts (cut)', VOCAB.cuts),
    table('What an element does', VOCAB.actions),
    table('The set: looks', VOCAB.looks),
    table('The set: air', VOCAB.air),
  ].join('\n');
}
