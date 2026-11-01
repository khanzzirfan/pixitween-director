// What the reference ads teach, written for Muse (docs/direction/corpus/06-reference-films.md and debug/movies/LEARNINGS.md: eight 9:16 product
// ads measured shot by shot). It goes into the board prompt as a short deck: how great ads are cut, then two worked boards in our own shot
// vocabulary. The deck is craft, not content: it must not make every board the same, so the prompt says to take the idea and not the things.

/** The craft rules and devices, one line each. */
export const CRAFT = [
  'One idea per film. The best ads rest on a single visual contrast: one warm accent in a cold world, one bright object in black, a tiny product in a huge world then a close-up of its label. Pick yours first and let every shot serve it.',
  'The hook is the first second: the lens is already inside the action (a splash, falling pieces, a light burst), pushing in hard.',
  'Push-in is the default move; a pull-out is the payoff, used once. The cut rate speeds up through the middle (0.4-1.0 s shots), then stops: the last shot holds 12-37% of the film so the price can be read.',
  'Tell the scale story: wide (the product small in its world), label macro (the label fills the frame), then the hero. Alternate wide and macro; never three of one size in a row.',
  'The product stays still; the world moves round it: pieces fall, orbit, burst, or a swirl wraps it. Change the material of the world every shot or two (ice, then liquid, then powder) while the light stays the same.',
  'Use things that belong to THIS product and its feeling: what it is made of, what it is used with, where it is enjoyed. A sensory peak (cold, hot, crisp, creamy) sits at 35-80% of the film, before the reveal.',
  'Cut where the world changes: a wipe (a quick dip to dark) or a cloud (a bloom of light filling the frame) starts the shot after it. Use two or three in the film, never on every cut.',
  'Vary the camera height: a low angle makes the product tall, a high angle looks down on the sensory peak, eye level is for the label and the reveal.',
  'Let the product move on purpose: it drops in on the hook or the first push, turns while the camera swings round it, and holds still for the label and the price.',
  'Set the light from the idea: tone (warm or cool key) and key (low for one bright object in black, high for a bright airy world).',
  'The dolly-zoom is the reveal, used once, late: the lens widens while the product holds its size.',
].join('\n- ');

/** Two worked boards, as the JSON Muse must write. They are different products with different ideas, so the shape is the lesson, not the elements. */
export const EXAMPLES = [
  {
    product: 'Canned latte, black can, amber label (the Costa-style low-key reference, invented brand "Nocturne Latte")',
    board: {
      concept: 'One bright object in black: the amber can is the only light in a dark room, and the world around it keeps changing material.',
      mood: 'low-key, amber, velvet', tone: 'warm', key: 'low',
      elements: [
        { id: 'milk-swirl', name: 'milk swirl', use: 'card', look: 'ribbon of warm white milk twisting through dark air, creamy, with a few droplets', pieces: 1, sizeM: 0.34 },
        { id: 'ice', name: 'ice cube', use: 'solid', glass: true, look: 'clear ice cube with frosted edges', pieces: 1, sizeM: 0.03 },
        { id: 'cocoa-dust', name: 'cocoa dust cloud', use: 'card', look: 'soft cloud of fine cocoa powder hanging in the air, brown, with lighter edges', pieces: 3, sizeM: 0.3 },
      ],
      beats: [
        { size: 'wide', move: 'push', seconds: 1.0, angle: 'low', phase: 'hook', product: 'drop', ingredient: { kind: 'milk-swirl', action: 'swirl' }, note: 'hook: milk swirls in the dark and the camera dives toward the amber glow' },
        { size: 'macro', move: 'push', seconds: 0.7, angle: 'eye', phase: 'build', product: 'still', note: 'the label fills the frame for a beat' },
        { size: 'close', move: 'orbit', seconds: 1.3, angle: 'low', phase: 'build', product: 'turn', cut: 'wipe', ingredient: { kind: 'ice', action: 'orbit' }, note: 'cold: ice circles the can as the camera swings round it' },
        { size: 'medium', move: 'push', seconds: 0.8, angle: 'high', phase: 'peak', product: 'still', cut: 'cloud', ingredient: { kind: 'cocoa-dust', action: 'splash' }, note: 'the world changes material: a powder cloud blooms' },
        { size: 'wide', move: 'pull', seconds: 1.1, angle: 'eye', phase: 'build', product: 'still', ingredient: { kind: 'milk-swirl', action: 'swirl' }, note: 'pull back so the can is small in the dark, the scale payoff' },
        { size: 'medium', move: 'dolly-zoom', seconds: 1.0, angle: 'eye', phase: 'reveal', product: 'still', note: 'reveal: the lens widens and the can holds its size' },
        { size: 'medium', move: 'hold', seconds: 2.4, phase: 'close', product: 'still', note: 'end hold: price and brand under the amber halo' },
      ],
    },
  },
  {
    product: 'Seasoning shaker (the Flavorbury reference, invented brand "Emberhouse")',
    board: {
      concept: 'Abundance: every shot is a gesture of spice, cut fast, ending wide on the shaker raised over a full table.',
      mood: 'warm, dusty, sunlit', tone: 'warm', key: 'mid',
      elements: [
        { id: 'chili-flake', name: 'chili flake', use: 'solid', look: 'single dried red chili flake, curled, with a glossy deep red skin', pieces: 1, sizeM: 0.018 },
        { id: 'spice-cloud', name: 'spice cloud', use: 'card', look: 'cloud of paprika-red spice powder in the air with golden light catching the edges', pieces: 3, sizeM: 0.34 },
        { id: 'herb-leaf', name: 'oregano leaf', use: 'solid', look: 'small green oregano leaf, slightly curled, matte with fine veins', pieces: 1, sizeM: 0.02 },
      ],
      beats: [
        { size: 'close', move: 'push', seconds: 0.8, angle: 'low', phase: 'hook', product: 'drop', ingredient: { kind: 'chili-flake', action: 'burst' }, note: 'hook: flakes burst toward the lens' },
        { size: 'macro', move: 'push', seconds: 0.6, angle: 'eye', phase: 'build', product: 'still', note: 'label macro, quick' },
        { size: 'medium', move: 'push', seconds: 0.7, angle: 'high', phase: 'build', product: 'turn', ingredient: { kind: 'herb-leaf', action: 'fall' }, note: 'leaves rain past the shaker' },
        { size: 'close', move: 'push', seconds: 0.7, angle: 'eye', phase: 'build', product: 'still', cut: 'cloud', ingredient: { kind: 'spice-cloud', action: 'splash' }, note: 'the camera dives into the spice cloud until it fills the frame: the cut' },
        { size: 'wide', move: 'push', seconds: 1.0, angle: 'low', phase: 'peak', product: 'still', ingredient: { kind: 'chili-flake', action: 'drift' }, note: 'out of the cloud, wide, flakes drifting in the light' },
        { size: 'medium', move: 'dolly-zoom', seconds: 1.1, angle: 'eye', phase: 'reveal', product: 'still', note: 'reveal' },
        { size: 'medium', move: 'hold', seconds: 2.1, phase: 'close', product: 'still', note: 'end hold: price and brand' },
      ],
    },
  },
  {
    product: 'Fruit yogurt cup, white cup, three flavours (the Veloura reference, invented brand "Meadowlight")',
    board: {
      concept: 'One grammar, repeated per flavour: a colour swirl, the cup dropping in with a splash, a push to the label. The backdrop is the flavour.',
      mood: 'high-key, cool white, fresh', tone: 'cool', key: 'high',
      elements: [
        { id: 'berry-swirl', name: 'berry swirl', use: 'card', look: 'ribbon of deep pink berry yogurt twisting through bright air, glossy, with small droplets', pieces: 1, sizeM: 0.36 },
        { id: 'blueberry', name: 'blueberry', use: 'solid', look: 'single plump blueberry with a dusty blue bloom and a small star-shaped crown', pieces: 1, sizeM: 0.022 },
        { id: 'yogurt-splash', name: 'yogurt splash', use: 'card', look: 'white yogurt splash rising as a crown then collapsing, thick and creamy, with a few drops', pieces: 3, sizeM: 0.3 },
      ],
      beats: [
        { size: 'wide', move: 'push', seconds: 0.9, angle: 'eye', phase: 'hook', product: 'still', ingredient: { kind: 'berry-swirl', action: 'swirl' }, note: 'hook: a pink swirl fills the frame, the colour of the flavour' },
        { size: 'medium', move: 'push', seconds: 0.8, angle: 'low', phase: 'build', product: 'drop', ingredient: { kind: 'yogurt-splash', action: 'splash' }, note: 'the cup drops in with a splash' },
        { size: 'macro', move: 'push', seconds: 0.8, angle: 'eye', phase: 'build', product: 'still', note: 'push to the label: the flavour name' },
        { size: 'close', move: 'orbit', seconds: 1.2, angle: 'high', phase: 'build', product: 'turn', cut: 'wipe', ingredient: { kind: 'blueberry', action: 'orbit' }, note: 'berries circle the cup as the camera swings round' },
        { size: 'wide', move: 'pull', seconds: 1.0, angle: 'eye', phase: 'peak', product: 'still', ingredient: { kind: 'blueberry', action: 'fall' }, note: 'pull back as berries rain: the payoff' },
        { size: 'medium', move: 'dolly-zoom', seconds: 1.0, angle: 'eye', phase: 'reveal', product: 'still', note: 'reveal' },
        { size: 'medium', move: 'hold', seconds: 2.3, phase: 'close', product: 'still', note: 'end hold: price and brand' },
      ],
    },
  },
];

const words = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3));

/**
 * The two worked boards least like the product, so Muse learns the shape of a board and not its contents: a coffee can is shown the
 * seasoning and the yogurt, not the latte. Ties keep the deck's order. `text` is the product's category and title.
 */
export function pickExamples(text: string, n = 2): typeof EXAMPLES {
  const mine = words(text);
  const overlap = (e: (typeof EXAMPLES)[number]) => {
    const theirs = words(`${e.product} ${e.board.concept} ${e.board.elements.map((x) => `${x.name} ${x.look}`).join(' ')}`);
    return [...mine].filter((w) => theirs.has(w)).length;
  };
  return EXAMPLES.map((e, i) => ({ e, i, o: overlap(e) })).sort((a, b) => a.o - b.o || a.i - b.i).slice(0, n).sort((a, b) => a.i - b.i).map((x) => x.e);
}

/** The deck as prompt text, for a product described by `text` (its category and title, so the examples shown are different from it). */
export function referenceDeck(text = ''): string {
  return [
    'HOW THE BEST ADS ARE CUT (measured on eight real 9:16 product ads; take the craft, not the things):',
    `- ${CRAFT}`,
    'TWO WORKED BOARDS, for other products with other ideas. Write yours in this shape, but with an idea and elements that belong to YOUR product; do not reuse their ideas, elements or shot order:',
    ...pickExamples(text).map((e) => `Product: ${e.product}\n${JSON.stringify(e.board)}`),
  ].join('\n');
}
