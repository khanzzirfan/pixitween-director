import type { Aspect } from './types';

// Look recipes for product clips (docs/direction/corpus/02-looks.md). A look decides the world behind the product, the light,
// how things move, the grade and the type; the director picks one per product and everything after that is deterministic.

export type LookId = 'tabletop-hero' | 'flat-lay' | 'studio-pedestal' | 'lifestyle-room' | 'ingredient-orbit' | 'price-promo';
/** A look a clip can have: one of the 2D recipes below, or hero-3d, where the product is a 3D model (hero3d-clip.ts) and has no recipe here. */
export type ClipLook = LookId | 'hero-3d';
export type OccasionId = 'everyday' | 'summer' | 'party' | 'festive' | 'wellness' | 'premium';
export type ProductShape = 'tall' | 'square' | 'wide';
/** Where the key light comes from; the product's shadows fall the other way. */
export type LightSide = 'left' | 'right' | 'top' | 'front';

export interface Look {
  id: LookId;
  /** Catalog categories and occasions this look suits, matched against the product's category words. */
  fits: string[];
  shapes: ProductShape[];
  lightSide: LightSide;
  /** Plate prompt template, or null when the world is drawn (a brand-colour field). */
  plate: string | null;
  /** Gaussian blur on the plate, so the product is the sharpest thing in frame. */
  plateBlur: number;
  /** contact: soft ellipse at the base. lifted-card: a deeper drop shadow that reads as a styled card on a top-down plate. reflection: contact plus a mirrored pack on a gloss floor. */
  shadow: 'contact' | 'lifted-card' | 'reflection';
  /** One dominant world move. */
  world: 'drift' | 'rotate' | 'rack-focus' | 'rays' | 'none';
  /** How the product arrives. It never rotates. */
  hero: 'land' | 'drop' | 'push';
  /** The third motion layer. */
  air: 'bokeh' | 'confetti' | 'none';
  /** A highlight that travels across the pack (the light moves, not the product). */
  sweep: boolean;
  grade: { color: string; opacity: number };
  price: 'disc' | 'pill' | 'burst';
  name: 'slim' | 'tracked-serif' | 'bold';
  /** How the price badge arrives. */
  pop: 'pop' | 'slam';
}

export interface Occasion {
  surface: string;
  props: string;
  palette: string;
}

export const LOOKS: Record<LookId, Look> = {
  'tabletop-hero': {
    id: 'tabletop-hero',
    fits: ['drink', 'beverage', 'coffee', 'food', 'bakery', 'sauce', 'jar', 'grocery', 'pantry'],
    shapes: ['tall', 'square'],
    lightSide: 'left',
    plate:
      '{aspect} photograph, camera at tabletop height, locked. {surface} fills the lower third, its centre left completely empty where an object will stand. {props} sit at the far left and far right edges, partly out of frame; behind, a softly blurred room. One large soft window camera-left, late-morning, so the surface is lit from the left and shadows fall short to the right. A thin haze drifts across the back. Palette of {palette}. Shallow depth of field: the front edge of the surface is sharp, the background is soft. No {productClass} in the centre, no people, no hands, no text, no labels, no logos.',
    plateBlur: 3,
    shadow: 'contact',
    world: 'drift',
    hero: 'land',
    air: 'bokeh',
    sweep: true,
    grade: { color: '#ffb870', opacity: 0.12 },
    price: 'disc',
    name: 'slim',
    pop: 'pop',
  },
  'flat-lay': {
    id: 'flat-lay',
    fits: ['party', 'gift', 'kids', 'snack', 'seasonal', 'confectionery', 'cake'],
    shapes: ['square', 'wide', 'tall'],
    lightSide: 'top',
    plate:
      '{aspect} top-down photograph of a styled table. {surface}; the centre third of the frame is empty. {props} are arranged in a loose ring at the frame edges. Soft overhead daylight, almost shadowless, high-key. Palette of {palette}. No {productClass} in the centre, no people, no hands, no text, no labels, no logos.',
    plateBlur: 0,
    shadow: 'lifted-card',
    world: 'rotate',
    hero: 'drop',
    air: 'confetti',
    sweep: false,
    grade: { color: '#fff1e0', opacity: 0.08 },
    price: 'disc',
    name: 'slim',
    pop: 'pop',
  },
  'studio-pedestal': {
    id: 'studio-pedestal',
    fits: ['cosmetics', 'beauty', 'skincare', 'perfume', 'fragrance', 'gadget', 'electronics', 'watch', 'spirits', 'premium'],
    shapes: ['tall', 'square'],
    lightSide: 'left',
    plate:
      '{aspect} studio photograph, camera at plinth height. A matte plinth at the lower third on a seamless backdrop; the top of the plinth is empty. A glossy floor in front shows a faint reflection of the plinth. One large soft source above camera-left; the backdrop falls darker toward the right edge. Palette of {palette}. No {productClass}, no people, no text, no logos, no lighting rig reflected.',
    plateBlur: 2,
    shadow: 'reflection',
    world: 'none',
    hero: 'push',
    air: 'none',
    sweep: true,
    grade: { color: '#e8d6c0', opacity: 0.1 },
    price: 'pill',
    name: 'tracked-serif',
    pop: 'pop',
  },
  'lifestyle-room': {
    id: 'lifestyle-room',
    fits: ['mug', 'cup', 'candle', 'home', 'kitchen', 'tea', 'homeware', 'decor'],
    shapes: ['square', 'tall'],
    lightSide: 'left',
    plate:
      '{aspect} photograph, camera at counter height. {surface} in the lower third with a clear empty space in the centre. Behind, a real room with a window and {props}, softly out of focus; warm lamps read as soft round discs. Daylight from the window camera-left mixed with warm tungsten lamps. Steam drifts slowly. Palette of {palette}. No {productClass} in the centre, no people, no text, no logos.',
    plateBlur: 0,
    shadow: 'contact',
    world: 'rack-focus',
    hero: 'land',
    air: 'bokeh',
    sweep: false,
    grade: { color: '#ffc98a', opacity: 0.14 },
    price: 'disc',
    name: 'slim',
    pop: 'pop',
  },
  'ingredient-orbit': {
    id: 'ingredient-orbit',
    fits: ['soda', 'energy', 'juice', 'candy', 'chips', 'soft drink'],
    shapes: ['tall', 'square'],
    lightSide: 'front',
    plate:
      '{aspect} seamless colour field in {palette}, gently graded from lighter at the centre to deeper at the edges. Soft bright light, no surface, no horizon. No objects, no text, no logos.',
    plateBlur: 0,
    shadow: 'lifted-card',
    world: 'none',
    hero: 'land',
    air: 'bokeh',
    sweep: true,
    grade: { color: '#ffffff', opacity: 0 },
    price: 'burst',
    name: 'bold',
    pop: 'pop',
  },
  'price-promo': {
    id: 'price-promo',
    fits: ['sale', 'clearance', 'multibuy', 'deal', 'offer'],
    shapes: ['tall', 'square', 'wide'],
    lightSide: 'front',
    plate: null,
    plateBlur: 0,
    shadow: 'lifted-card',
    world: 'rays',
    hero: 'land',
    air: 'none',
    sweep: false,
    grade: { color: '#ffffff', opacity: 0 },
    price: 'burst',
    name: 'bold',
    pop: 'slam',
  },
};

export const OCCASIONS: Record<OccasionId, Occasion> = {
  everyday: { surface: 'An oiled oak table', props: 'A linen napkin, a wooden board and fresh fruit', palette: 'warm creams, honey and sage' },
  summer: { surface: 'A sun-bleached wooden table', props: 'Ice cubes, cut citrus and a striped cloth', palette: 'bright whites, sky blue and citrus yellow' },
  party: { surface: 'Pink linen cloth', props: 'Confetti, paper straws, a slice of cake and ribbon curls', palette: 'saturated pinks, coral and gold' },
  festive: { surface: 'A dark wooden table with a wool runner', props: 'Pine sprigs, red ribbon and fairy lights', palette: 'deep green, red and warm gold' },
  wellness: { surface: 'A pale travertine slab', props: 'Smooth stones, eucalyptus and a glass of water', palette: 'pastel sage, sand and clay' },
  premium: { surface: 'Honed black marble', props: 'Brass details and dark velvet', palette: 'black, gold and oxblood' },
};

const OCCASION_WORDS: Record<OccasionId, string[]> = {
  everyday: [],
  summer: ['summer', 'ice', 'iced', 'cold', 'lemon', 'citrus', 'beach', 'bbq'],
  party: ['party', 'birthday', 'celebration', 'kids', 'gift'],
  festive: ['christmas', 'festive', 'holiday', 'winter', 'xmas', 'diwali', 'eid', 'new year'],
  wellness: ['wellness', 'organic', 'vegan', 'skincare', 'spa', 'tea', 'herbal'],
  premium: ['premium', 'luxury', 'reserve', 'gold', 'night', 'spirits', 'perfume'],
};

/** Tall (can, bottle), square (jar, mug) or wide (box, bar, tray), from the cut-out's proportions. */
export function productShape(width: number, height: number): ProductShape {
  const a = width / height;
  return a < 0.75 ? 'tall' : a > 1.4 ? 'wide' : 'square';
}

const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const mentions = (text: string, terms: string[]) => {
  const t = ` ${words(text).join(' ')} `;
  return terms.filter((w) => t.includes(` ${w} `));
};

export interface LookPick {
  look: ClipLook;
  occasion: OccasionId;
  /** One line a person can read: why this look. */
  why: string;
}

/**
 * The default director's pick for one product: a sale gets the promo look; a tall round pack whose label could be unwrapped
 * (`round`, from prepareProduct3D) gets the 3D hero; otherwise the look whose category words the product mentions most and whose
 * shapes include the pack's shape; tabletop hero when nothing matches. A model (or the user) may override it; this is the floor,
 * so a catalog never ships without a considered look.
 */
export function pickLook(p: { title: string; category?: string; width: number; height: number; onSale?: boolean; occasion?: OccasionId; round?: boolean }): LookPick {
  const text = `${p.category ?? ''} ${p.title}`;
  const occasion: OccasionId =
    p.occasion ?? ((Object.keys(OCCASION_WORDS) as OccasionId[]).find((o) => mentions(text, OCCASION_WORDS[o]).length > 0) ?? 'everyday');
  if (p.onSale) return { look: 'price-promo', occasion, why: 'on sale, so the price leads' };
  const shape = productShape(p.width, p.height);
  if (p.round && shape === 'tall') return { look: 'hero-3d', occasion, why: 'tall round pack with a label to wrap, so it turns in 3D' };
  let best: { id: LookId; hits: string[] } | undefined;
  for (const l of Object.values(LOOKS)) {
    if (l.id === 'price-promo' || !l.shapes.includes(shape)) continue;
    const hits = mentions(text, l.fits);
    if (hits.length && (!best || hits.length > best.hits.length)) best = { id: l.id, hits };
  }
  if (best) return { look: best.id, occasion, why: `${shape} pack, "${best.hits[0]}" suits the ${best.id} look` };
  return { look: shape === 'wide' ? 'flat-lay' : 'tabletop-hero', occasion, why: `${shape} pack with no category match, so the ${shape === 'wide' ? 'flat-lay' : 'tabletop'} default` };
}

const ASPECT_WORDS: Record<Aspect, string> = { '9:16': 'Vertical 9:16', '16:9': 'Wide 16:9', '1:1': 'Square 1:1' };

/** The plate prompt for a look: slots in the corpus order, the product's own class named in the negatives so no rival copy appears. Null when the look draws its world. */
export function lookPlatePrompt(lookId: LookId, o: { occasion: OccasionId; productClass: string; aspect: Aspect }): string | null {
  const t = LOOKS[lookId].plate;
  if (!t) return null;
  const occ = OCCASIONS[o.occasion];
  const cls = o.productClass.trim().toLowerCase() || 'products';
  return t
    .replace('{aspect}', ASPECT_WORDS[o.aspect])
    .replace('{surface}', occ.surface)
    .replace('{props}', occ.props)
    .replace('{palette}', occ.palette)
    .replace('{productClass}', cls);
}

/** Drop-shadow direction (After Effects degrees, 180 = straight down) for light from a side: the shadow falls away from it. */
export const shadowDirection = (side: LightSide): number => (side === 'left' ? 140 : side === 'right' ? 220 : 180);
