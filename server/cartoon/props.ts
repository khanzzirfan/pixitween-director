// Owned by S16b. The toy prop library: which model in web/public/cartoon/props (made by scripts/make-props.mjs) stands for a prop the showrunner asked for.
const KEYWORDS: Array<[model: string, words: RegExp]> = [
  // Quaternius furniture and food packs (converted by scripts/fbx-to-glb.mjs), tried first
  ['q-sodacan', /\b(cans?|cold ?brew|soda|tin)\b/i],
  ['q-nightstand-1', /\b(night ?stand|bedside table)\b/i],
  ['q-bed-single', /\b(bed|pillow|blanket|cot)\b/i],
  ['q-light-desk', /\b(desk lamp|bedside lamp|reading lamp)\b/i],
  ['q-light-floor1', /\b(lamps?|lantern|light)\b/i],
  ['q-carpet-round', /\b(rug|mat|carpet)\b/i],
  ['q-houseplant-1', /\b(plants?|flower|cactus|fern)\b/i],
  ['q-kitchen-fridge', /\b(fridge|refrigerator)\b/i],
  ['q-kitchen-oven', /\b(oven|stove|cooker)\b/i],
  ['q-kitchen-sink', /\b(sink)\b/i],
  ['q-kitchen-2drawers', /\b(counter|kitchen|drawers?)\b/i],
  ['q-kitchen-cabinet1', /\b(cabinet|cupboard)\b/i],
  ['q-couch-small1', /\b(couch|sofa)\b/i],
  ['q-bookshelf', /\b(bookshelf|bookcase|books?|shelf)\b/i],
  ['q-window-large1', /\b(windows?)\b/i],
  ['q-curtains-double', /\b(curtains?)\b/i],
  ['q-table-roundsmall', /\b(table|desk)\b/i],
  ['q-chair-1', /\b(chair|seat)\b/i],
  ['q-stool', /\b(stool)\b/i],
  ['q-trashcan-small1', /\b(trash|bin)\b/i],
  ['q-plate-1', /\b(plate|dish)\b/i],
  ['q-cake', /\b(cake)\b/i],
  ['q-cupcake', /\b(cupcakes?)\b/i],
  ['q-milkshake', /\b(milkshake|shake)\b/i],
  ['q-pizza', /\b(pizza)\b/i],
  ['q-icecream', /\b(ice ?cream)\b/i],
  // the generated toy props (scripts/make-props.mjs) for what the packs lack
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
