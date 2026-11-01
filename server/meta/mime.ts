import type { Buffer } from 'node:buffer';

/** Sniff an image mime from magic bytes: PNG 89 50 4E 47, JPEG FF D8, WebP RIFF....WEBP. */
export function sniffImageMime(b: Buffer): 'image/png' | 'image/jpeg' | 'image/webp' {
  if (b.length > 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length > 2 && b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (b.length > 12 && b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  return 'image/png';
}

export const dataUrl = (b: Buffer, mime: string): string => `data:${mime};base64,${b.toString('base64')}`;
