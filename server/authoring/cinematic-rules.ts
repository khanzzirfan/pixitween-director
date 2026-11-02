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
    push: 'the camera moves in on the product (the default; builds desire)',
    pull: 'the camera moves out (the payoff; once)',
    hold: 'the camera stays and drifts (the last shot, or a beat of calm)',
    orbit: 'the camera swings round the product on an arc (shows its form)',
    truck: "the camera slides sideways past the set, the product staying centred: the world streams by (parallax; the film's motion shot)",
    crane: 'the camera rises or falls while looking at the product, low to high or back (reveals the world)',
    whip: 'a fast swing that brakes into the frame, for a quick cut (short shot, never first or last, at most twice)',
    rack: 'the focus moves from the soft near lights to the product while the camera creeps in (a dreamy reveal, once)',
    'dolly-zoom': 'the lens widens while the product holds its size (the reveal; once, late)',
  },
  angles: { low: 'looks up at the product (power)', eye: 'level (the label and the reveal)', high: 'looks down on it (the sensory peak)' },
  phases: { hook: 'the first shot: already moving', build: 'the middle', peak: 'the sensory high point', reveal: 'the dolly-zoom', close: 'the last shot: the price rests' },
  productMoves: { still: 'holds still', turn: 'turns on', drop: 'drops in from above' },
  cuts: { hard: 'a plain cut', wipe: 'a quick dip to dark across the cut', cloud: 'a bloom of light across the cut' },
  actions: { fall: 'drop through the frame', burst: 'fly outward', orbit: 'circle the product', drift: 'float', splash: 'a flat card plays its stages', swirl: 'a flat card drifts and rolls' },
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
  },
} as const;

/** The shot list: how long, how many, how it is paced (the reference ads, measured). */
export const SHEET = {
  minTotal: 6,
  maxTotal: 12,
  /** every shot but the last */
  minBeat: 0.4,
  maxBeat: 2.5,
  /** the hook */
  firstMax: 1.5,
  /** the last shot's share of the film */
  holdMin: 0.12,
  holdMax: 0.37,
  minBeats: 5,
  maxBeats: 10,
  /** at least this share of the moving shots are pushes */
  pushShare: 0.5,
  /** where the one peak sits, as a share of the film */
  peakFrom: 0.35,
  peakTo: 0.8,
} as const;

/** The camera's moves: how many kinds, how often. */
export const MOVE_RULES = {
  minKinds: 3,
  whipMax: 2,
  /** a whip is a quick swing */
  whipSeconds: 1,
  rackMax: 1,
  truckMax: 2,
  craneMax: 2,
  dollyMax: 1,
} as const;

/** The words on screen. */
export const TEXT_RULES = {
  maxShots: 3,
  maxWords: 5,
  /** a shot can say about this many words a second, and always at least `minWords` */
  wordsPerSecond: 4,
  minWords: 2,
  taglineWords: 6,
} as const;

/** The camera's numbers (metres, degrees, shares). */
export const CAMERA = {
  /** a push starts this many times further than it arrives: the hook comes in hard (the references push 40-90 %), later pushes ease in */
  pushFromHook: 1.7,
  pushFromLater: 1.3,
  /** a push in a wide shot dives harder: the product is small in a big world, and a 30 % push barely changes the picture (the motion check found it) */
  pushFromWide: 1.9,
  /** a truck slides this share of the distance either side */
  truckShare: 0.3,
  /** a whip starts this many degrees round */
  whipAzimuth: 55,
  /** the tremor, as a share of the camera's distance (about one percent of the frame's height) */
  shakeAmount: 0.007,
  /** the most tremor keys a shot may take */
  shakeKeysMax: 3,
  /** a layer may hold 64 tweens; the tremor must leave room for everything else */
  tweenBudget: 62,
  /** the speed a cut leaves and enters at, as a share of the shot's mean speed: never from a stop */
  minCutSpeed: 0.5,
  /** the most a flat cut-out may turn either way, degrees: it shows only its front */
  flatSwingMax: 30,
  /** the end hold's product stands at most this share of the frame's height, so the name and tagline above it and the price beside it have room */
  maxHoldHeight: 0.64,
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
  const M = MOVE_RULES;
  const T = TEXT_RULES;
  const C = CAMERA;
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  return [
    `A film is ${S.minBeats} to ${S.maxBeats} shots and ${S.minTotal} to ${S.maxTotal} s in all.`,
    `The first shot is the hook: at most ${S.firstMax} s, already moving, and it pushes in from ${C.pushFromHook} times its final distance.`,
    `Every shot but the last lasts ${S.minBeat} to ${S.maxBeat} s.`,
    `The last shot is a hold of ${pct(S.holdMin)} to ${pct(S.holdMax)} of the film, with no element and no words: the price, name and tagline land there.`,
    `At least ${pct(S.pushShare)} of the moving shots are pushes; later pushes start ${C.pushFromLater} times further out, and pushes in a wide shot ${C.pushFromWide} times.`,
    `Use at least ${M.minKinds} different camera moves, and a truck or a crane in every film (they make the set slide past the product).`,
    `At most ${M.whipMax} whips (each at most ${M.whipSeconds} s, never first or last), ${M.rackMax} rack focus, ${M.truckMax} trucks, ${M.craneMax} cranes, ${M.dollyMax} dolly-zoom (never first; a macro dolly-zoom is framed as a close).`,
    `Two shots in a row differ in size, angle or move; never three of one size in a row.`,
    `Exactly one shot is the peak, at ${pct(S.peakFrom)} to ${pct(S.peakTo)} of the film.`,
    `Include a wide shot and a label macro; no element and no words in the macro.`,
    `A cut lands while the camera is moving: the shot before leaves, and the shot after enters, at at least ${pct(C.minCutSpeed)} of its mean speed (a hold and the end of a whip are exempt).`,
    `The tremor is ${pct(C.shakeAmount)} of the camera distance, at most ${C.shakeKeysMax} keys a shot, and is dropped when the world's ${C.tweenBudget}-tween budget has no room.`,
    `At most ${T.maxShots} shots carry words, each ${T.minWords} to ${T.maxWords} words and about ${T.wordsPerSecond} words a second at most; never a price or a number; the tagline is at most ${T.taglineWords} words.`,
    `In the end hold the product stands at most ${pct(C.maxHoldHeight)} of the frame's height (the shot before it, whose framing the hold keeps, is held to the same), so the name, tagline and price never sit on it.`,
    `A flat, wide product never fills more than ${pct(C.maxWidthShare)} of the frame's width, and a flat cut-out turns at most ${C.flatSwingMax} degrees either way.`,
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
    'The board prompt teaches Muse from this book, the checker holds Muse to it, and the motion check judges the rendered film by it.',
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
