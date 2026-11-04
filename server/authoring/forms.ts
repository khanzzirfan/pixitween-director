// The shape of a thing in 3D, as Muse names it from the photo, and the numbers the builder sweeps it with. Muse says what the thing is
// (a round tub, a boxy carton, a folded towel, a round berry, a thin leaf); code turns the word into depth and cross-section, so a film
// never falls back to one guess for every product. Pure.

/** A product's form. round: a bottle, can, tub, jar or fruit (round in plan). boxy: a carton, box or cooler. slab: a thin flat thing standing
 * up (a folded towel, a pouch, a book, a phone). lying: a round thing lying on its side (a rolled towel or mat, a rolling pin, a loaf). */
export const PRODUCT_FORMS = ['round', 'boxy', 'slab', 'lying'] as const;
export type ProductForm = (typeof PRODUCT_FORMS)[number];

/** An element's form. round: a berry, cherry, grape, bean or nut (as deep as it is wide). thin: a leaf, petal, chip or flake. chunk: a
 * slice, wedge or piece with flat faces. */
export const ELEMENT_FORMS = ['round', 'thin', 'chunk'] as const;
export type ElementForm = (typeof ELEMENT_FORMS)[number];

export interface BodyNumbers {
  /** depth as a share of the shorter side */
  depth: number;
  /** the cross-section's exponent: 2 round, higher boxier; absent is a straight-sided extrusion */
  section?: number;
  axis?: 'up' | 'across';
}

/** Each product form: its section and axis, its usual depth, and the depths Muse may pick inside it. */
export const PRODUCT_BODY: Record<ProductForm, BodyNumbers & { range: [number, number] }> = {
  round: { depth: 0.95, section: 2, range: [0.75, 1.1] },
  boxy: { depth: 0.6, section: 4.5, range: [0.3, 1] },
  slab: { depth: 0.25, section: 5, range: [0.08, 0.45] },
  lying: { depth: 0.95, section: 2, axis: 'across', range: [0.6, 1.1] },
};

/** Each element form, as a share of the piece's shorter side. A chunk keeps the old straight extrusion. */
export const ELEMENT_BODY: Record<ElementForm, BodyNumbers> = {
  round: { depth: 0.9, section: 2 },
  thin: { depth: 0.08 },
  chunk: { depth: 0.35 },
};

/** The product's body from Muse's form and, when given, its depth (kept inside the form's range). */
export function productBody(form: ProductForm, depth?: number): BodyNumbers & { form: ProductForm } {
  const f = PRODUCT_BODY[form];
  const d = depth === undefined ? f.depth : Math.min(f.range[1], Math.max(f.range[0], depth));
  return { form, depth: Math.round(d * 100) / 100, section: f.section!, ...(f.axis ? { axis: f.axis } : {}) };
}
