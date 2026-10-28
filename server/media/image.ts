import sharp from 'sharp';

const MIME: Record<string, string> = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };

export async function imageSize(buf: Buffer): Promise<{ width: number; height: number; mime: string }> {
  const m = await sharp(buf).metadata();
  const mime = m.format ? MIME[m.format] : undefined;
  if (!m.width || !m.height || !mime) throw new Error('not a supported image');
  return { width: m.width, height: m.height, mime };
}

/** `rgb` is an encoded image of size WxH; `alpha` is raw 8-bit W*H. Returns an RGBA PNG. */
export async function alphaCutout(rgb: Buffer, alpha: Buffer, o: { feather?: number } = {}): Promise<Buffer> {
  const { width, height } = await imageSize(rgb);
  if (alpha.length !== width * height) throw new Error(`alpha length ${alpha.length} does not match ${width}x${height}`);
  let a = sharp(alpha, { raw: { width, height, channels: 1 } });
  if (o.feather !== undefined && o.feather >= 0.3) a = a.blur(o.feather);
  const alphaRaw = await a.extractChannel(0).raw().toBuffer();
  const color = await sharp(rgb).removeAlpha().raw().toBuffer();
  const out = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    out[i * 4] = color[i * 3]!;
    out[i * 4 + 1] = color[i * 3 + 1]!;
    out[i * 4 + 2] = color[i * 3 + 2]!;
    out[i * 4 + 3] = alphaRaw[i]!;
  }
  return sharp(out, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

export async function flatten(
  layers: Array<{ png: Buffer; left: number; top: number }>,
  size: { width: number; height: number },
  bg?: string,
): Promise<Buffer> {
  return sharp({ create: { width: size.width, height: size.height, channels: 4, background: bg ?? { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(layers.map((l) => ({ input: l.png, left: l.left, top: l.top })))
    .png()
    .toBuffer();
}

export async function resizeFit(buf: Buffer, maxSide: number, format: 'png' | 'jpeg'): Promise<Buffer> {
  const img = sharp(buf).resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true });
  return (format === 'png' ? img.png() : img.jpeg()).toBuffer();
}
