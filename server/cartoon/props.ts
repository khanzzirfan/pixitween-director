// Owned by S16b. The toy prop library: which model in web/public/cartoon/props (made by scripts/make-props.mjs) stands for a prop the showrunner asked for.
const KEYWORDS: Array<[model: string, words: RegExp]> = [
  ['can', /\b(cans?|cold ?brew|soda|tin|bottle)\b/i],
  ['clock', /\b(clock|alarm)\b/i],
  ['lamp', /\b(lamps?|light|lantern)\b/i],
  ['bed', /\b(bed|pillow|blanket|cot)\b/i],
  ['counter', /\b(counter|cabinet|kitchen|cupboard|fridge|stove)\b/i],
  ['table', /\b(table|desk|shelf|nightstand|stand)\b/i],
  ['window', /\b(windows?|curtains?)\b/i],
  ['rug', /\b(rug|mat|carpet)\b/i],
  ['plant', /\b(plants?|flower|pot|cactus)\b/i],
  ['mug', /\b(mug|cup|coffee)\b/i],
  ['books', /\b(books?|stack)\b/i],
  ['chair', /\b(chair|stool|seat)\b/i],
  ['ball', /\b(ball|toy|balloon)\b/i],
];

/** The library model for a prop name; the crate when nothing matches. */
export function propModel(name: string): string {
  return KEYWORDS.find(([, re]) => re.test(name))?.[0] ?? 'crate';
}
export const propSrc = (model: string): string => (model === 'crate' ? '/cartoon/prop-crate.glb' : `/cartoon/props/${model}.glb`);
