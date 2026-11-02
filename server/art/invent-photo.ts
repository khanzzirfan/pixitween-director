// A film made with no photo: the image model invents a product photo from the brief, so the crew has a hero to cut out.
import type { Buffer } from 'node:buffer';
import type { Aspect } from '@shared/composition';
import type { MetaClients } from '@shared/ports';
import { extractBrandTerms, lintPrompt } from './lint';

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** What the image model is told: a lone product on a plain backdrop, described by the brief with brand and person names taken out. */
export function inventPhotoPrompt(brief: string): string {
  let described = brief.replace(/\s+/g, ' ').trim().slice(0, 300);
  const terms = [...extractBrandTerms(described), ...lintPrompt(described, { subject: true }).violations.map((v) => v.term)];
  for (const term of terms) if (term) described = described.replace(new RegExp(escapeRegExp(term), 'gi'), '').replace(/\s+/g, ' ').trim();
  return `A single product photographed on a plain, softly lit studio backdrop, centred with space around it, no text, no logos, no people. The product: ${described || 'a simple everyday product'}`;
}

/** A square photo: the crew cuts the product out of it, so the canvas shape does not matter. */
export async function inventProductPhoto(meta: MetaClients, brief: string, _aspect: Aspect): Promise<Buffer> {
  return meta.image.generate(inventPhotoPrompt(brief), '1024x1024');
}
