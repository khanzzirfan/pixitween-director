import type { BoardForm } from './beatsheet';

// The owner's verdicts on real films, as examples for Muse's choice between the 3D film and the 2D one. A line is added each time a film is
// judged by eye. They teach by shape and material, not by product name: Muse reads the traits in them and applies them to any photo.

export interface FormVerdict {
  product: string;
  traits: string;
  form: BoardForm;
  why: string;
}

export const FORM_VERDICTS: readonly FormVerdict[] = [
  { product: 'cold brew can', traits: 'rigid, stands upright, round, crisp metal edge', form: '3d', why: 'form and shine are the selling point; the body is a true cylinder' },
  { product: 'perfume bottle', traits: 'rigid, stands upright, boxy glass, crisp edge', form: '3d', why: 'glass catches the light and turns well' },
  { product: 'cooler box', traits: 'rigid, stands upright, boxy, crisp plastic edge', form: '3d', why: 'a solid box reads well from every side' },
  { product: 'swim goggles', traits: 'rigid, lies flat, thin, crisp edge', form: '3d', why: 'a thin shell still looks right when it turns and catches rim light' },
  { product: 'striped beach towel', traits: 'soft, lies on its side as a roll, fuzzy fabric edge, sold on softness and pattern', form: '2d', why: 'a solid body turns a soft roll into a stiff pill with smeared stripes; the photo already shows the softness' },
];

/** The examples as lines of Muse's prompt. */
export function verdictLines(): string[] {
  return FORM_VERDICTS.map((v) => `- ${v.product} (${v.traits}): ${v.form === '3d' ? '3D' : '2D'}, because ${v.why}.`);
}
