// RGBA pictures in and out of PNG, and the trim every product picture goes through. Shared by prepare.ts and the turnaround modules.
import sharp from 'sharp';
import type { Rgba } from './pixels';

export async function decode(png: Buffer): Promise<Rgba> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength) };
}

export const encode = (data: Uint8ClampedArray, width: number, height: number): Promise<Buffer> =>
  sharp(Buffer.from(data.buffer, data.byteOffset, data.byteLength), { raw: { width, height, channels: 4 } }).png().toBuffer();

/** The smallest box that holds every opaque pixel, as a cropped copy. */
export function trim(img: Rgba): Rgba {
  let [x0, y0, x1, y1] = [img.width, img.height, -1, -1];
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++)
      if (img.data[(y * img.width + x) * 4 + 3]! > 127) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
  if (x1 < 0) return img;
  const width = x1 - x0 + 1;
  const height = y1 - y0 + 1;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) data.set(img.data.subarray(((y + y0) * img.width + x0) * 4, ((y + y0) * img.width + x0 + width) * 4), y * width * 4);
  return { width, height, data };
}

/** A PNG trimmed to its opaque box. */
export async function trimPng(png: Buffer): Promise<Buffer> {
  const t = trim(await decode(png));
  return encode(t.data, t.width, t.height);
}
