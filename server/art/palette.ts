import type { Buffer } from 'node:buffer';
import sharp from 'sharp';

export interface Accent {
  hex: string;
  /** 0..1: how colourful the pixels it came from were. A white mug has none, and the caller should look elsewhere. */
  chroma: number;
}

const toHex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

/**
 * The brand-like colour in an image: the average of its saturated, mid-tone, opaque pixels, weighted by how saturated they are,
 * so a cream can with a brown band gives the brown and not the cream. Pixels that are near white, near black, grey or see-through
 * are ignored. Deterministic; reads a 48 px copy.
 */
export async function dominantAccent(png: Buffer): Promise<Accent> {
  const { data, info } = await sharp(png).resize(48, 48, { fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let r = 0, g = 0, b = 0, w = 0, seen = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    if (data[i + 3]! < 200) continue;
    const R = data[i]!, G = data[i + 1]!, B = data[i + 2]!;
    seen++;
    const max = Math.max(R, G, B), min = Math.min(R, G, B);
    const lum = (0.2126 * R + 0.7152 * G + 0.0722 * B) / 255;
    const sat = max === 0 ? 0 : (max - min) / max;
    if (sat < 0.25 || lum > 0.88 || lum < 0.08) continue;
    r += R * sat; g += G * sat; b += B * sat; w += sat;
  }
  if (!w) return { hex: '#3d4a5c', chroma: 0 };
  return { hex: toHex(r / w, g / w, b / w), chroma: Math.min(1, w / Math.max(1, seen)) };
}
