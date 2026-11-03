import { readSnapshots, type FilmSnapshot } from '../corpus/films';

// What the reference ads teach, written for Muse (docs/direction/corpus/06-reference-films.md and debug/movies/LEARNINGS.md: eight 9:16 product
// ads measured shot by shot). It goes into the board prompt as a short deck: how great ads are cut, then two worked boards in our own shot
// vocabulary. The deck is craft, not content: it must not make every board the same, so the prompt says to take the idea and not the things.

/** What the references do, one line each: observations to choose from, not rules to follow. Muse decides which of them its idea wants. */
export const CRAFT = [
  'The best ads rest on one idea, often a contrast: one warm accent in a cold world, one bright object in black, a tiny product in a huge world, a calm object in a violent storm. Pick yours and let every choice serve it.',
  'Ads differ in shape. Some are fast: ten shots, whips, glitches, hard cuts. Some are slow: three shots, a long lens, a camera that floats. Some are one long move that changes lens as it goes. Choose the shape the idea needs, not the shape of the last film.',
  'A camera can push in to build desire, pull out to pay off, truck so the set streams past, crane to show the world, orbit to show form, whip into a cut, rack focus from near lights to the product, or change lens mid-move (the dolly-zoom). Use the ones the idea wants, as many or as few as it wants; repeating one is fine when the idea is repetition.',
  'A lens is a mood: a long lens (14-20 degrees) flattens and compresses, calm and expensive; 30 is natural; a wide lens (60-85) stretches and exaggerates, energetic and close to the action. A move can end on a different lens than it started.',
  'Scale tells a story: the product small in its world, a crop of its label, the hero. Use the scales that carry your idea; none is required.',
  'The world can move round a still product (pieces fall, orbit, burst, a swirl wraps it, smoke drifts behind it), or the product can move (drop in, turn). Change the material of the world when the story changes.',
  'Use things that belong to THIS product and its feeling: what it is made of, what it is used with, where it is enjoyed.',
  'A cut can change the world: a plain cut, a dip to dark, a bloom of light, or a shader transition (a zoom blur, a whip, a water ripple, a swirl, a glitch, a film burn, light streaks) chosen for what the story does at that cut.',
  'Rhythm is yours: fast then slow, slow then a burst, even beats, one long take. The last shot holds so the price can be read.',
  'Set the light from the idea: tone (warm or cool key) and key (low for one bright object in black, high for a bright airy world).',
].join('\n- ');

/**
 * Worked boards, as the JSON Muse must write. They are different products with different ideas AND different shapes (a fast ten-shot ad, a
 * slow three-shot one, one long move that changes lens, a world-first parallax film), so the lesson is the vocabulary and the freedom, never one recipe.
 * Camera fields are optional; the boards that write them out show how.
 */
export const EXAMPLES = [
  {
    product: 'Canned energy drink, silver can, neon label (a fast, loud ad)',
    board: {
      concept: 'Detonation: the can is a calm object in a storm of fizz, and the film never lets the picture rest.',
      mood: 'loud, neon, cold', tone: 'cool', key: 'low',
      set: { look: 'night', air: 'spray' },
      finish: { glow: 'strong', grain: 'heavy', vignette: 'strong', fringe: true, floor: 'mirror', wet: 'heavy', caustics: 'none' },
      elements: [
        { id: 'fizz-splash', name: 'cold liquid', use: 'liquid', color: '#7fe3ff', clear: true, look: 'clear icy blue liquid', pieces: 1, sizeM: 0.34 },
        { id: 'ice', name: 'ice cube', use: 'solid', glass: true, look: 'clear ice cube', pieces: 1, sizeM: 0.03 },
      ],
      beats: [
        { size: 'close', move: 'whip', seconds: 0.5, cut: 'streak', product: 'drop', ingredient: { kind: 'fizz-splash', action: 'splash', place: 'around', scale: 1.2 }, camera: { from: { around: 70, lens: 70 }, to: { fill: 0.7, around: 0, lens: 45 }, ease: 'whip' }, note: 'a wide, stretched lens whips onto the can as the liquid erupts' },
        { size: 'macro', move: 'push', seconds: 0.4, cut: 'hard', camera: { to: { fill: 1.4, lens: 24 }, ease: 'snap' }, note: 'a crop of the label, a snap' },
        { size: 'medium', move: 'orbit', seconds: 0.6, cut: 'glitch', product: 'turn', ingredient: { kind: 'ice', action: 'orbit' }, camera: { from: { around: -50, height: -5, lens: 55 }, to: { around: 50, height: 10, lens: 55 }, ease: 'linear' }, note: 'a fast orbit, ice circling' },
        { size: 'wide', move: 'crane', seconds: 0.5, camera: { from: { height: -8, fill: 0.2, lens: 80 }, to: { height: 40, fill: 0.3, lens: 80 } }, note: 'the camera falls from the floor to a high view of the whole night world' },
        { size: 'close', move: 'push', seconds: 0.5, ingredient: { kind: 'ice', action: 'burst', place: 'front' }, camera: { to: { fill: 0.8 }, ease: 'snap' }, note: 'ice bursts toward the lens' },
        { size: 'medium', move: 'truck', seconds: 0.6, camera: { from: { side: -0.5 }, to: { side: 0.5 }, ease: 'linear' }, note: 'the neon night slides past' },
        { size: 'close', move: 'whip', seconds: 0.4, cut: 'zoom', camera: { from: { around: -80, lens: 30 }, to: { around: 0, fill: 0.75 }, ease: 'whip' }, note: 'one last whip onto the can' },
        { size: 'medium', move: 'hold', seconds: 2.0, note: 'end hold: price and brand under the glow' },
      ],
    },
  },
  {
    product: 'Eau de parfum bottle, amber glass, brushed gold cap (a slow, quiet ad)',
    board: {
      concept: 'Stillness as luxury: almost nothing moves, and what does moves slowly through warm smoke.',
      mood: 'slow, amber, hushed', tone: 'warm', key: 'low', handheld: false,
      set: { look: 'night', air: 'smoke' },
      finish: { glow: 'soft', grain: 'fine', vignette: 'strong', fringe: false, floor: 'mirror', wet: 'none', caustics: 'none' },
      elements: [
        { id: 'amber-mist', name: 'perfume mist', use: 'vapour', color: '#d9a24a', look: 'a slow curl of warm amber mist', pieces: 1, sizeM: 0.4 },
      ],
      beats: [
        { size: 'medium', move: 'push', seconds: 2.4, ingredient: { kind: 'amber-mist', action: 'rise', place: 'behind', scale: 1.3 }, camera: { from: { fill: 0.25, lens: 18, height: 4 }, to: { fill: 0.5, lens: 18, height: 6 }, ease: 'float' }, note: 'a long lens, the bottle emerging from the dark as the mist curls up behind it' },
        { size: 'close', move: 'orbit', seconds: 3.0, cut: 'hard', product: 'turn', camera: { from: { around: -30, fill: 0.8, lens: 20 }, to: { around: 30, fill: 0.8, lens: 20 }, ease: 'smooth' }, note: 'the camera drifts round the gold cap, light travelling across the glass' },
        { size: 'macro', move: 'push', seconds: 1.6, camera: { to: { fill: 1.3, lens: 16 }, ease: 'smooth' }, note: 'a long lens closes on the engraved label' },
        { size: 'medium', move: 'hold', seconds: 2.4, note: 'end hold: price and brand, the mist still turning behind' },
      ],
    },
  },
  {
    product: 'Running shoe, white mesh, red sole (one long move)',
    board: {
      concept: 'One unbroken move: the camera starts on the sole at the ground and rises and widens until the whole stride is in frame.',
      mood: 'clean, bright, kinetic', tone: 'neutral', key: 'high',
      set: { look: 'sky', air: 'dust' },
      finish: { glow: 'soft', grain: 'none', vignette: 'none', fringe: false, floor: 'none', wet: 'none', caustics: 'none' },
      elements: [
        { id: 'grit', name: 'dust cloud', use: 'vapour', color: '#d9cfc0', look: 'a kick of pale dust', pieces: 1, sizeM: 0.3 },
        { id: 'grass', name: 'grass blade', use: 'solid', look: 'single green grass blade', pieces: 1, sizeM: 0.04 },
      ],
      beats: [
        { size: 'macro', move: 'crane', seconds: 3.5, product: 'turn', ingredient: { kind: 'grit', action: 'burst', place: 'behind' }, camera: { from: { height: -3, fill: 1.4, lens: 22 }, to: { height: 22, fill: 0.35, lens: 60 }, ease: 'smooth' }, note: 'one move: the lens widens from tight on the sole to the whole shoe in the air' },
        { size: 'wide', move: 'truck', seconds: 2.0, ingredient: { kind: 'grass', action: 'fall' }, camera: { from: { side: -0.35 }, to: { side: 0.35 }, ease: 'linear' }, note: 'the camera slides along as grass falls through the light' },
        { size: 'medium', move: 'hold', seconds: 2.0, note: 'end hold: price and brand' },
      ],
    },
  },
  {
    product: 'Pour-over coffee maker, glass and steel (a world-first ad)',
    board: {
      concept: 'The kitchen at six in the morning: the product barely moves, the world drifts past it, and warmth arrives with the steam.',
      mood: 'warm, morning, patient', tone: 'warm', key: 'mid',
      set: { look: 'sunset', air: 'bokeh' },
      finish: { glow: 'soft', grain: 'fine', vignette: 'soft', fringe: false, floor: 'glossy', wet: 'none', caustics: 'soft' },
      elements: [
        { id: 'steam', name: 'steam', use: 'vapour', color: '#f4efe8', look: 'soft white steam rising in wisps', pieces: 1, sizeM: 0.35 },
        { id: 'drip', name: 'coffee', use: 'liquid', color: '#3a2112', look: 'dark glossy coffee', pieces: 1, sizeM: 0.28 },
        { id: 'bean', name: 'coffee bean', use: 'solid', look: 'single roasted coffee bean, glossy, dark brown', pieces: 1, sizeM: 0.02 },
      ],
      beats: [
        { size: 'wide', move: 'truck', seconds: 2.2, ingredient: { kind: 'steam', action: 'rise', place: 'behind' }, camera: { from: { side: -0.4, fill: 0.2, lens: 26 }, to: { side: 0.4, fill: 0.2, lens: 26 }, ease: 'smooth' }, note: 'the morning room slides past a small, still maker' },
        { size: 'close', move: 'push', seconds: 1.4, cut: 'burn', ingredient: { kind: 'drip', action: 'pour' }, camera: { to: { fill: 0.8, height: 12 } }, note: 'a glossy stream pours as the camera comes in' },
        { size: 'medium', move: 'orbit', seconds: 1.6, ingredient: { kind: 'bean', action: 'drift' }, camera: { from: { around: 40 }, to: { around: -10 } }, note: 'beans drift in the light as the camera comes round to the front' },
        { size: 'close', move: 'hold', seconds: 2.4, note: 'end hold: price and brand' },
      ],
    },
  },
];

const words = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3));

/**
 * The worked boards least like the product, so Muse learns the shape of a board and not its contents: a coffee can is shown the
 * seasoning and the yogurt, not the latte. Ties keep the deck's order. `text` is the product's category and title.
 */
export function pickExamples(text: string, n = 2): typeof EXAMPLES {
  const mine = words(text);
  const overlap = (e: (typeof EXAMPLES)[number]) => {
    const theirs = words(`${e.product} ${e.board.concept} ${e.board.elements.map((x) => `${x.name} ${x.look}`).join(' ')}`);
    return [...mine].filter((w) => theirs.has(w)).length;
  };
  // equal overlap is broken by a hash of the product's words, so different products meet different examples (the same pair for every film would teach one shape)
  const spin = (e: (typeof EXAMPLES)[number]) => [...`${text}|${e.product}`].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);
  return EXAMPLES.map((e, i) => ({ e, i, o: overlap(e), h: spin(e) })).sort((a, b) => a.o - b.o || a.h - b.h).slice(0, n).sort((a, b) => a.i - b.i).map((x) => x.e);
}

/** Lower-case words of four letters or more, with a plural s dropped, so "bottles" meets "bottle". */
const stems = (s: string) => new Set([...words(s)].map((w) => (w.length > 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)));

let snapshots: FilmSnapshot[] | undefined;
/** The measured product ads in the corpus (docs/direction/corpus/films), read once. Films without a review or with under three shots are left out. */
function corpusAds(): FilmSnapshot[] {
  if (!snapshots) {
    try {
      snapshots = readSnapshots().filter((f) => f.review && f.review.kind === 'product-ad' && f.shots.length >= 3);
    } catch {
      snapshots = [];
    }
  }
  return snapshots;
}

/** How many kinds of camera move a film uses: the tie-break, so a product the corpus has never seen is shown the most varied films. */
const moveKinds = (f: FilmSnapshot) => new Set(f.shots.map((s) => s.move.replace(/\s*\(.*?\)/g, '').replace(/^slow /, ''))).size;

/**
 * The real films in the corpus nearest the product: the most words shared between the product's words (category, title, brief) and
 * what each film is of (its reviewed subject and summary). Stable for the same words. `films` defaults to the corpus.
 */
export function nearestFilms(text: string, n = 3, films: readonly FilmSnapshot[] = corpusAds()): FilmSnapshot[] {
  const score = (f: FilmSnapshot) => filmMatch(text, f);
  return films
    .map((f) => ({ f, s: score(f), k: moveKinds(f) }))
    .sort((a, b) => b.s - a.s || b.k - a.k || a.f.slug.localeCompare(b.f.slug))
    .slice(0, n)
    .map((x) => x.f);
}

/** How many of the product's words the film is about (its reviewed subject and summary); 0 when the corpus has nothing like it. */
export function filmMatch(text: string, f: FilmSnapshot): number {
  const theirs = stems(`${f.review?.subject ?? ''} ${f.review?.summary ?? ''}`);
  return [...stems(text)].filter((w) => theirs.has(w)).length;
}

/** A real film as prompt text: what it is, then each measured shot (length, size, camera move, what it does), then what it teaches. */
export function filmLines(f: FilmSnapshot, maxShots = 12): string {
  const r = f.review!;
  const label = new Map(r.shot_labels.map((l) => [l.shot, l]));
  const shots = f.shots.slice(0, maxShots).map((s) => {
    const l = label.get(s.idx);
    const move = s.move.replace(/\s*\(.*?\)/g, '');
    return `${s.dur_s.toFixed(1)}s ${l?.scale ?? ''} ${move}${l?.beat ? ` [${l.beat}]` : ''}${l?.note ? `: ${l.note}` : ''}`.replace(/\s+/g, ' ').trim();
  });
  return [
    `Real film: ${r.subject} (${f.duration_s.toFixed(1)} s, ${f.shots.length} shots).${r.summary.startsWith(r.subject) ? '' : ` ${r.summary.slice(0, 320)}`}`,
    ...shots.map((x) => `  - ${x}`),
    ...(f.shots.length > maxShots ? [`  - (${f.shots.length - maxShots} more shots)`] : []),
    ...r.learn.slice(0, 2).map((x) => `  Lesson: ${x}`),
  ].join('\n');
}

/**
 * The deck as prompt text, for a product described by `text` (its category, title and brief): the craft, the real corpus films nearest it
 * (measured shot by shot, so Muse sees how ads for this kind of product really move), and one worked board least like it for the JSON shape.
 */
export function referenceDeck(text = '', films?: readonly FilmSnapshot[]): string {
  const near = nearestFilms(text, 3, films);
  return [
    'WHAT THE BEST ADS DO (measured on real 9:16 product ads; these are options and observations, not rules: take what your idea needs):',
    `- ${CRAFT}`,
    ...(near.length
      ? [
          `${near.some((f) => filmMatch(text, f) > 0) ? 'REAL FILMS NEAREST THIS PRODUCT' : 'REAL FILMS (the corpus has none of this kind of product; these move the most)'}, measured shot by shot from the corpus (shot length, size, camera move, what happens). Study how they move and pace, then translate it into our shot vocabulary; do not copy their things or their order:`,
          ...near.map((f) => filmLines(f)),
        ]
      : []),
    'WORKED BOARDS, for other products with other ideas and other shapes. They show the vocabulary and how far it stretches, not a recipe: do not reuse their shot order, lengths or moves; write an idea, shape and elements that belong to YOUR product:',
    ...pickExamples(text, 2).map((e) => `Product: ${e.product}\n${JSON.stringify(e.board)}`),
  ].join('\n');
}
