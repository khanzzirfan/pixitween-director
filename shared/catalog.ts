// Owned by Catalog Crew C1. The product feed, the catalog and the price helpers every other C-story reads.
import { z } from 'zod';

export const SLOT_KINDS = ['image', 'title', 'price', 'salePrice', 'badge'] as const;
export const slotKindSchema = z.enum(SLOT_KINDS);
export type SlotKind = z.infer<typeof slotKindSchema>;

export const productSchema = z.object({
  id: z.string().min(1).max(64),
  title: z.string().min(1).max(120),
  /** Minor units would hide a typo like 4.5 vs 45; the feed's own decimal is kept and compared after normalising. */
  price: z.number().nonnegative(),
  salePrice: z.number().nonnegative().optional(),
  currency: z.string().length(3).default('USD'),
  imageUrl: z.string().min(1),
  category: z.string().min(1).max(60),
  url: z.string().optional(),
});
export type Product = z.infer<typeof productSchema>;

export const variantSchema = z.object({
  filmId: z.string().min(1),
  status: z.enum(['queued', 'building', 'checking', 'ready', 'flagged', 'failed']),
  version: z.number().int().nonnegative(),
  priceCheck: z.enum(['ok', 'mismatch', 'unread']).optional(),
  mp4Url: z.string().optional(),
});
export type Variant = z.infer<typeof variantSchema>;

export const catalogSchema = z.object({
  id: z.string().min(1),
  masterFilmId: z.string().min(1),
  products: z.array(productSchema).min(1).max(200),
  variants: z.record(z.string(), variantSchema),
});
export type Catalog = z.infer<typeof catalogSchema>;

const CURRENCY_SYMBOL: Record<string, string> = { USD: '$', EUR: '€', GBP: '£' };

/** What the ad shows: "$4.50". Two decimals always, so the check and the text agree. */
export function formatPrice(amount: number, currency = 'USD'): string {
  const sym = CURRENCY_SYMBOL[currency];
  const n = amount.toFixed(2);
  return sym ? `${sym}${n}` : `${n} ${currency}`;
}

/** Reads "$4.50", "4,50 €", "USD 4.5" or "4.5" into a number; undefined when there is no amount. */
export function parsePrice(text: string): number | undefined {
  const m = text.replace(/\s/g, '').match(/(\d+(?:[.,]\d{1,2})?)/);
  if (!m) return undefined;
  const n = Number(m[1]!.replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
}

/** The price an ad must show: the sale price when there is one. */
export const shownPrice = (p: Product): number => p.salePrice ?? p.price;

export type FeedResult = { ok: true; products: Product[] } | { ok: false; errors: string[] };

function splitRow(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') quoted = false; else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

/** Parses a CSV feed (header: id,title,price,sale_price,currency,image_link,category,link). Every bad row is reported, none is guessed. */
export function parseFeed(csv: string): FeedResult {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { ok: false, errors: ['the feed needs a header row and at least one product'] };
  const head = splitRow(lines[0]!).map((h) => h.toLowerCase());
  const col = (...names: string[]) => head.findIndex((h) => names.includes(h));
  const idx = { id: col('id'), title: col('title'), price: col('price'), sale: col('sale_price', 'saleprice'), cur: col('currency'), img: col('image_link', 'imageurl', 'image'), cat: col('category', 'product_type'), url: col('link', 'url') };
  const missing = (['id', 'title', 'price', 'img', 'cat'] as const).filter((k) => idx[k] < 0);
  if (missing.length) return { ok: false, errors: [`the feed header is missing: ${missing.join(', ')}`] };
  const errors: string[] = [];
  const products: Product[] = [];
  const seen = new Set<string>();
  lines.slice(1).forEach((line, i) => {
    const c = splitRow(line);
    const row = i + 2;
    const price = parsePrice(c[idx.price] ?? '');
    const sale = idx.sale >= 0 && c[idx.sale] ? parsePrice(c[idx.sale]!) : undefined;
    if (price === undefined) return void errors.push(`row ${row}: no price`);
    const parsed = productSchema.safeParse({
      id: c[idx.id], title: c[idx.title], price, ...(sale !== undefined ? { salePrice: sale } : {}),
      ...(idx.cur >= 0 && c[idx.cur] ? { currency: c[idx.cur] } : {}),
      imageUrl: c[idx.img], category: c[idx.cat], ...(idx.url >= 0 && c[idx.url] ? { url: c[idx.url] } : {}),
    });
    if (!parsed.success) return void errors.push(`row ${row}: ${parsed.error.issues.map((x) => `${x.path.join('.')} ${x.message}`).join('; ')}`);
    if (seen.has(parsed.data.id)) return void errors.push(`row ${row}: duplicate id '${parsed.data.id}'`);
    seen.add(parsed.data.id);
    products.push(parsed.data);
  });
  return errors.length ? { ok: false, errors } : { ok: true, products };
}
