import { Buffer } from 'node:buffer';
import sharp from 'sharp';

// One labelled landscape image per sheet, so a reviewer (Muse or a person) can judge the parts of a film at a glance.

const CELL_W = 480;
const TITLE_H = 44;
const LABEL_H = 30;
const SWATCH_H = 56;
const BG = '#14141a';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const hex = (r: number, g: number, b: number) => `#${[r, g, b].map((n) => Math.round(n).toString(16).padStart(2, '0')).join('')}`;
const rgb = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
/** Distance between two colours, 0 the same and 1 black against white. */
const distance = (a: [number, number, number], b: [number, number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) / (255 * Math.sqrt(3));

/** The most common colours of the opaque pixels, on a small copy: #rrggbb, most common first, near-identical colours skipped. */
export async function swatchesOf(png: Buffer, count = 4): Promise<string[]> {
  const { data, info } = await sharp(png).resize(64, 64, { fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const bins = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i < info.width * info.height; i++) {
    const [r, g, b, a] = [data[i * 4]!, data[i * 4 + 1]!, data[i * 4 + 2]!, data[i * 4 + 3]!];
    if (a < 200) continue;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bin = bins.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    bin.n++;
    bin.r += r;
    bin.g += g;
    bin.b += b;
    bins.set(key, bin);
  }
  const out: Array<[number, number, number]> = [];
  for (const bin of [...bins.values()].sort((x, y) => y.n - x.n)) {
    const c: [number, number, number] = [bin.r / bin.n, bin.g / bin.n, bin.b / bin.n];
    if (out.some((o) => distance(o, c) < 0.08)) continue;
    out.push(c);
    if (out.length >= count) break;
  }
  return out.map(([r, g, b]) => hex(r, g, b));
}

/** The middle 50 % across and 40 % down of a front render: the label close-up. */
export async function labelCrop(png: Buffer): Promise<Buffer> {
  const { width = 0, height = 0 } = await sharp(png).metadata();
  return sharp(png)
    .extract({ left: Math.round(width * 0.25), top: Math.round(height * 0.3), width: Math.round(width * 0.5), height: Math.round(height * 0.4) })
    .png()
    .toBuffer();
}

/** The sheet: a title bar, the panels in reading order in equal cells with their labels, and an optional row of colour swatches. A landscape JPEG. */
export async function composeSheet(o: { title: string; panels: Array<{ png: Buffer; label: string }>; columns?: number; swatches?: string[] }): Promise<Buffer> {
  const columns = Math.max(1, Math.min(o.columns ?? Math.min(3, o.panels.length), o.panels.length || 1));
  const rows = Math.max(1, Math.ceil(o.panels.length / columns));
  const swatchBar = o.swatches?.length ? SWATCH_H : 0;
  const width = columns * CELL_W;
  // landscape whatever the rows: the cells get shorter when the sheet would be taller than wide
  const cellH = Math.max(120, Math.min(CELL_W, Math.floor((width * 0.75 - TITLE_H - swatchBar) / rows)));
  const height = TITLE_H + rows * cellH + swatchBar;
  const tiles = await Promise.all(
    o.panels.map(async (p, i) => {
      const picture = await sharp(p.png).resize(CELL_W, cellH - LABEL_H, { fit: 'contain', background: BG }).png().toBuffer();
      const label = Buffer.from(`<svg width="${CELL_W}" height="${LABEL_H}"><rect width="${CELL_W}" height="${LABEL_H}" fill="#000" opacity="0.78"/><text x="10" y="20" font-family="Helvetica, Arial, sans-serif" font-size="15" fill="#fff">${esc(p.label)}</text></svg>`);
      return [
        { input: picture, left: (i % columns) * CELL_W, top: TITLE_H + Math.floor(i / columns) * cellH },
        { input: label, left: (i % columns) * CELL_W, top: TITLE_H + Math.floor(i / columns) * cellH + cellH - LABEL_H },
      ];
    }),
  );
  const title = Buffer.from(`<svg width="${width}" height="${TITLE_H}"><text x="12" y="29" font-family="Helvetica, Arial, sans-serif" font-size="20" font-weight="bold" fill="#fff">${esc(o.title)}</text></svg>`);
  const chips = (o.swatches ?? []).map((s, i) => {
    const left = 12 + i * 118;
    const text = rgb(s).reduce((a, b) => a + b, 0) > 380 ? '#000' : '#fff';
    return { input: Buffer.from(`<svg width="110" height="40"><rect width="110" height="40" rx="6" fill="${s}"/><text x="8" y="25" font-family="Helvetica, Arial, sans-serif" font-size="14" fill="${text}">${esc(s)}</text></svg>`), left, top: TITLE_H + rows * cellH + 8 };
  });
  return sharp({ create: { width, height, channels: 3, background: BG } })
    .composite([{ input: title, left: 0, top: 0 }, ...tiles.flat(), ...chips])
    .jpeg({ quality: 85 })
    .toBuffer();
}
