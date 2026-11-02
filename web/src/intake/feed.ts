// The Brief screen's reading of what was dropped: a CSV feed is parsed only to show product cards
// and to see which photos are still missing. The server's parser stays the judge of the feed.

export interface PreviewProduct {
  id: string;
  title: string;
  price: string;
  /** the feed's image_link, read as the photo this product needs */
  link: string;
  /** the uploaded photo that stands in for the link, when there is one */
  photo?: File;
  /** a repo path the server reads on its own, so the product needs no upload */
  inRepo: boolean;
}

export interface FeedPreview {
  products: PreviewProduct[];
  /** why the feed could not be read, in plain words */
  error?: string;
}

/** The links the server reads from the repo itself (see server/lineup/photos.ts). */
const REPO_PREFIXES = ['fixtures/', 'data/assets/'];

/** One CSV row into cells: quotes, doubled quotes and commas inside quotes. */
function splitRow(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      cells.push(cell);
      cell = '';
    } else cell += ch;
  }
  cells.push(cell);
  return cells.map((c) => c.trim());
}

const money = (price: string, sale: string, currency: string): string => {
  const shown = sale || price;
  const n = Number(shown);
  if (!shown || Number.isNaN(n)) return shown;
  const symbol = ({ USD: '$', EUR: '€', GBP: '£' } as Record<string, string>)[currency.toUpperCase()] ?? '';
  const text = Number.isInteger(n) ? String(n) : n.toFixed(2);
  return symbol ? `${symbol}${text}` : `${text}${currency ? ` ${currency}` : ''}`;
};

export function parseFeed(text: string): FeedPreview {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { products: [], error: 'That CSV has no products in it.' };
  const header = splitRow(lines[0]).map((h) => h.toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const [id, title, price, sale, currency, link] = ['id', 'title', 'price', 'sale_price', 'currency', 'image_link'].map(col);
  if (id < 0 || title < 0 || price < 0 || link < 0) {
    return { products: [], error: 'That CSV needs id, title, price and image_link columns.' };
  }
  const products = lines.slice(1).map((line): PreviewProduct => {
    const cells = splitRow(line);
    const at = (i: number) => (i >= 0 ? cells[i] ?? '' : '');
    const image = at(link);
    return {
      id: at(id),
      title: at(title),
      price: money(at(price), at(sale), at(currency)),
      link: image,
      inRepo: REPO_PREFIXES.some((p) => image.startsWith(p)),
    };
  });
  return { products };
}

const stem = (name: string): string => {
  const file = name.split('/').pop() ?? name;
  const dot = file.lastIndexOf('.');
  return dot > 0 ? file.slice(0, dot) : file;
};

/** The uploaded photo for a link: the same rule the server applies (an exact stem, or the link's stem starting with the photo's). */
function photoFor(link: string, photos: File[]): File | undefined {
  const wanted = stem(link);
  let best: File | undefined;
  for (const photo of photos) {
    const s = stem(photo.name);
    if (s !== wanted && !wanted.startsWith(`${s}-`) && !wanted.startsWith(`${s}_`)) continue;
    if (!best || s.length > stem(best.name).length) best = photo;
  }
  return best;
}

/** The products with the photos that stand in for their links. */
export function matchPhotos(products: PreviewProduct[], photos: File[]): PreviewProduct[] {
  return products.map((p) => ({ ...p, photo: photoFor(p.link, photos) }));
}

/** The products that still have no photo, uploaded or in the repo. */
export const needingPhoto = (products: PreviewProduct[]): PreviewProduct[] => products.filter((p) => !p.photo && !p.inRepo);

export interface Dropped {
  csv?: File;
  photos: File[];
  /** files that are neither a CSV nor an image */
  rejected: string[];
}

const isCsv = (f: File) => /\.csv$/i.test(f.name) || f.type === 'text/csv';
const isImage = (f: File) => f.type.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(f.name);

/** Sorts whatever was dropped: one CSV (the last wins), the images, and what it could not use. */
export function sortDropped(files: File[]): Dropped {
  const out: Dropped = { photos: [], rejected: [] };
  for (const f of files) {
    if (isCsv(f)) out.csv = f;
    else if (isImage(f)) out.photos.push(f);
    else out.rejected.push(f.name);
  }
  return out;
}

/** A file's text; older engines and jsdom have no File.text(). */
export function readText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });
}
