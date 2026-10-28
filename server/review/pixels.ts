import sharp from 'sharp';
import type { RuleDeps, Box } from './types';
import { linearise } from './contrast';
type Pixels = { width: number; height: number; channels: number; data: Buffer };
export function makeSharpPixelDeps(
  readAsset: (id: string) => Promise<Buffer>,
): Required<Pick<RuleDeps, 'plateLuminance' | 'maskCoverage'>> {
  const cache = new Map<string, Promise<Pixels>>();
  const load = (id: string) => {
    let p = cache.get(id);
    if (!p) {
      p = readAsset(id).then(async (bytes) => {
        const image = sharp(bytes);
        const m = await image.metadata();
        if (!m.width || !m.height) throw new Error(`invalid pixel asset ${id}`);
        const scale = Math.min(1, 256 / Math.max(m.width, m.height));
        const { data, info } = await image
          .resize(Math.max(1, Math.round(m.width * scale)), Math.max(1, Math.round(m.height * scale)), { fit: 'fill' })
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });
        return { width: info.width, height: info.height, channels: info.channels, data };
      });
      cache.set(id, p);
    }
    return p;
  };
  const region = (b: Box, p: Pixels) => {
    const left = Math.max(0, Math.min(1, b.left)),
      top = Math.max(0, Math.min(1, b.top)),
      right = Math.max(0, Math.min(1, b.right)),
      bottom = Math.max(0, Math.min(1, b.bottom));
    const x0 = Math.floor(left * p.width),
      y0 = Math.floor(top * p.height),
      x1 = Math.ceil(right * p.width),
      y1 = Math.ceil(bottom * p.height);
    if (x1 <= x0 || y1 <= y0) throw new RangeError('empty region');
    return { x0, y0, x1, y1 };
  };
  return {
    async plateLuminance(id, b) {
      const p = await load(id),
        r = region(b, p);
      let sum = 0,
        count = 0;
      for (let y = r.y0; y < r.y1; y++)
        for (let x = r.x0; x < r.x1; x++) {
          const i = (y * p.width + x) * p.channels;
          sum += 0.2126 * linearise(p.data[i]!) + 0.7152 * linearise(p.data[i + 1]!) + 0.0722 * linearise(p.data[i + 2]!);
          count++;
        }
      return sum / count;
    },
    async maskCoverage(id, b) {
      const p = await load(id),
        r = region(b, p);
      let hit = 0,
        count = 0;
      for (let y = r.y0; y < r.y1; y++)
        for (let x = r.x0; x < r.x1; x++) {
          const i = (y * p.width + x) * p.channels;
          const alpha = p.channels >= 4 ? p.data[i + 3]! : 255;
          const val = p.channels >= 4 && alpha < 255 ? alpha : p.data[i]!;
          if (val >= 128) hit++;
          count++;
        }
      return hit / count;
    },
  };
}
