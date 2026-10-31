// S19 live: the catalogue path end to end on a small CSV feed. Reads the feed, cuts out each distinct product photo once (SAM),
// picks a look per product, builds a retail clip per product and one variant film per product line, and writes them to
// web/public/cartoon/catalog/ with an index. Colour comes from the photo (the cut-out's brand-like colour, or the plate's when the
// product is white), the brand from the feed's brand column, and the tagline from the words the line's titles share.
// Paid (SAM about $0.0025 a photo, plus a Muse plate at $0.01 for each look and product class without one), so it prints an
// estimate and exits unless --yes is passed. Usage: npm run live -- s19-catalog [feed.csv] [--yes]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { shownPrice, parseFeed, type Product } from '../../shared/catalog';
import { cutout } from '../../server/art/cutout';
import { dominantAccent } from '../../server/art/palette';
import { generateLookPlate } from '../../server/art/stills';
import { LOOKS, pickLook, type LookId } from '../../server/authoring/looks';
import { buildRetailClip } from '../../server/authoring/retail-clip';
import { buildVariantFilm, colorFor, taglineFor, variantNames } from '../../server/authoring/variant-film';
import { buildDeps } from '../../server/main';
import type { LiveScript } from './run';

const FEED = 'fixtures/catalog/feed-6.csv';
const OUT = 'web/public/cartoon/catalog';
const PLATES = 'web/public/cartoon/look-plates.json';
/** The product class for SAM and for the plate's "no <class> in the centre", by category; "product" when not listed. */
const NOUN: Record<string, string> = { drinks: 'can', home: 'mug' };
const FALLBACK_ACCENT = '#3d4a5c';

const feedArg = (args?: string[]) => args?.find((a) => a.endsWith('.csv')) ?? FEED;
const load = (args?: string[]): Product[] => {
  const r = parseFeed(readFileSync(feedArg(args), 'utf8'));
  if (!r.ok) throw new Error(`feed rejected:\n${r.errors.join('\n')}`);
  return r.products;
};

/** A saved plate's key: look and product class. Plates from s18 have the bare look as key and were made for cans. */
const plateKey = (look: string, noun: string) => `${look}:${noun}`;
type PlateRef = { id: string; width: number; height: number };
const findPlate = (plates: Record<string, PlateRef>, look: string, noun: string): PlateRef | undefined => plates[plateKey(look, noun)] ?? (noun === 'can' ? plates[look] : undefined);

/** A stored asset's bytes: the run's data dir, else ./data/assets where viewed assets are copied. */
const assetBytes = (dataDir: string, id: string): Buffer | undefined => {
  for (const dir of [`${dataDir}/assets`, './data/assets']) for (const ext of ['png', 'jpg']) if (existsSync(`${dir}/${id}.${ext}`)) return readFileSync(`${dir}/${id}.${ext}`);
  return undefined;
};

export const describe: LiveScript['describe'] = () =>
  `S19 live: the products of a CSV feed (default ${FEED}) -> one SAM cut-out per distinct photo, a look per product, a 4 s retail clip each, and a variant film per line. Needs META_API_KEY and SAM. Writes ${OUT}/.`;
export const estimateUsd: LiveScript['estimateUsd'] = (args) => {
  const products = load(args);
  const photos = new Set(products.map((p) => p.imageUrl)).size;
  const looks = new Set(products.map((p) => `${p.category}`)).size;
  return Math.round((photos * 0.0025 + looks * 0.01) * 1000) / 1000; // allows one missing plate per category
};

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export const run: LiveScript['run'] = async ({ env, log, args }) => {
  if (!env.metaApiKey) throw new Error('META_API_KEY is required for s19-catalog');
  const products = load(args);
  const deps = await buildDeps(env);
  const film = await deps.films.create({ aspect: '9:16', title: 'Catalog test', brief: { text: 'Catalog test', productAssetId: '' }, assets: [] });
  const ctx = deps.makeToolCtx(film.id);
  mkdirSync(OUT, { recursive: true });
  const plates: Record<string, PlateRef> = existsSync(PLATES) ? JSON.parse(readFileSync(PLATES, 'utf8')) : {};
  const t0 = Date.now();
  let cost = 0;

  // one cut-out per distinct photo, and the colour the photo carries
  const cuts = new Map<string, { id: string; width: number; height: number; accent: string; chroma: number }>();
  for (const photo of new Set(products.map((p) => p.imageUrl))) {
    const p = products.find((x) => x.imageUrl === photo)!;
    const noun = NOUN[p.category] ?? 'product';
    const r = await cutout(ctx, { source: readFileSync(photo), noun, sceneId: 'catalog' });
    cost += 0.0025;
    const bytes = assetBytes(env.DATA_DIR, r.cutout.id);
    const acc = bytes ? await dominantAccent(bytes) : { hex: FALLBACK_ACCENT, chroma: 0 };
    cuts.set(photo, { id: r.cutout.id, width: r.cutout.width ?? 0, height: r.cutout.height ?? 0, accent: acc.hex, chroma: acc.chroma });
    log(`cut-out ${photo} (${noun}): ${r.cutout.id} ${r.cutout.width}x${r.cutout.height}, confidence ${r.confidence ?? 'n/a'}, photo colour ${acc.hex} (chroma ${acc.chroma.toFixed(2)})`);
  }

  // a look per product; a plate for each look and product class that has none yet
  const picks = products.map((p) => {
    const cut = cuts.get(p.imageUrl)!;
    return { p, cut, noun: NOUN[p.category] ?? 'product', pick: pickLook({ title: p.title, category: p.category, width: cut.width, height: cut.height, onSale: p.salePrice !== undefined }) };
  });
  for (const x of picks) {
    if (LOOKS[x.pick.look].plate === null || findPlate(plates, x.pick.look, x.noun)) continue;
    const a = await generateLookPlate(ctx, { look: x.pick.look, occasion: x.pick.occasion, productClass: `${x.noun}s`, aspect: '9:16', sceneId: x.pick.look });
    plates[plateKey(x.pick.look, x.noun)] = { id: a.id, width: a.width ?? 720, height: a.height ?? 1280 };
    cost += 0.01;
    log(`plate for ${x.pick.look}/${x.pick.occasion} (${x.noun}s): ${a.id}`);
  }
  writeFileSync(PLATES, JSON.stringify(plates, null, 2));

  // the accent: the photo's own colour; a white product takes its plate's colour; failing that, slate
  const accentOf = async (x: (typeof picks)[number]): Promise<string> => {
    if (x.cut.chroma > 0.05) return x.cut.accent;
    // a look that draws its own world (promo) has no plate: use any plate made for this product class
    const plate = findPlate(plates, x.pick.look, x.noun) ?? Object.entries(plates).find(([k]) => k.endsWith(`:${x.noun}`))?.[1];
    const bytes = plate ? assetBytes(env.DATA_DIR, plate.id) : undefined;
    const fromPlate = bytes ? await dominantAccent(bytes) : undefined;
    return fromPlate && fromPlate.chroma > 0 ? fromPlate.hex : FALLBACK_ACCENT;
  };

  // a retail clip per product
  const index: Array<Record<string, unknown>> = [];
  for (const x of picks) {
    const { p, cut, pick } = x;
    const plate = findPlate(plates, pick.look, x.noun);
    const accent = await accentOf(x);
    const clip = buildRetailClip({
      aspect: '9:16',
      look: pick.look as LookId,
      ...(plate ? { plate: { id: plate.id, src: `/api/assets/${plate.id}`, width: plate.width, height: plate.height } } : {}),
      product: { id: cut.id, src: `/api/assets/${cut.id}`, width: cut.width, height: cut.height },
      title: p.title,
      price: shownPrice(p),
      ...(p.salePrice !== undefined ? { wasPrice: p.price } : {}),
      currency: p.currency,
      ...(p.brand ? { brand: p.brand } : {}),
      accent,
    });
    const file = `${slug(p.id)}.json`;
    writeFileSync(`${OUT}/${file}`, JSON.stringify(clip));
    index.push({ id: p.id, title: p.title, price: shownPrice(p), was: p.salePrice !== undefined ? p.price : null, look: pick.look, why: pick.why, accent, file });
    log(`${p.id}: ${pick.look} (${pick.why}), $${shownPrice(p)}${p.salePrice !== undefined ? ` (was ${p.price})` : ''}, accent ${accent} -> ${file}`);
  }

  // a variant film per line: products that share a category and a photo
  const lines = new Map<string, typeof picks>();
  for (const x of picks) lines.set(`${x.p.category}|${x.p.imageUrl}`, [...(lines.get(`${x.p.category}|${x.p.imageUrl}`) ?? []), x]);
  for (const [key, group] of lines) {
    if (group.length < 2) continue;
    const titles = group.map((g) => g.p.title);
    const names = variantNames(titles);
    const brand = group[0]!.p.brand ?? titles[0]!.split(/\s+/).slice(0, 2).join(' ');
    const accent = await accentOf(group[0]!);
    const vf = buildVariantFilm({
      aspect: '9:16',
      brand,
      tagline: taglineFor(titles, group[0]!.p.brand),
      accent,
      variants: group.map((g, n) => ({
        product: { id: g.cut.id, src: `/api/assets/${g.cut.id}`, width: g.cut.width, height: g.cut.height },
        name: names[n]!,
        color: colorFor(names[n]!, n),
        price: shownPrice(g.p),
        ...(g.p.salePrice !== undefined ? { wasPrice: g.p.price } : {}),
        currency: g.p.currency,
      })),
    });
    const file = `film-${slug(key.split('|')[0]!)}.json`;
    writeFileSync(`${OUT}/${file}`, JSON.stringify(vf));
    index.push({ film: key.split('|')[0], brand, tagline: taglineFor(titles, group[0]!.p.brand), variants: names, accent, file });
    log(`variant film ${file}: ${brand} - ${taglineFor(titles, group[0]!.p.brand)} - ${names.join(', ')}, accent ${accent}`);
  }
  writeFileSync(`${OUT}/index.json`, JSON.stringify(index, null, 2));
  log(`done in ${Math.round((Date.now() - t0) / 1000)} s, about $${cost.toFixed(4)}; assets in ${env.DATA_DIR}/assets (copy into ./data/assets to view)`);
};
