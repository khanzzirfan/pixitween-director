// S19 live: the catalogue path end to end on a small CSV feed. Reads the feed, cuts out each distinct product photo once (SAM),
// picks a look per product, builds a retail clip per product and one variant film per product line, and writes them to
// web/public/cartoon/catalog/ with an index. Paid (SAM about $0.0025 a photo, plus a Muse plate for any look without one at $0.01),
// so it prints an estimate and exits unless --yes is passed. Usage: npm run live -- s19-catalog [feed.csv] [--yes]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { shownPrice, parseFeed, type Product } from '../../shared/catalog';
import { cutout } from '../../server/art/cutout';
import { generateLookPlate } from '../../server/art/stills';
import { LOOKS, pickLook, type LookId } from '../../server/authoring/looks';
import { buildRetailClip } from '../../server/authoring/retail-clip';
import { buildVariantFilm, colorFor, variantNames } from '../../server/authoring/variant-film';
import { buildDeps } from '../../server/main';
import type { LiveScript } from './run';

const FEED = 'fixtures/catalog/feed-6.csv';
const OUT = 'web/public/cartoon/catalog';
const PLATES = 'web/public/cartoon/look-plates.json';
/** The pick's noun for SAM, by category; "product" when the category is not listed. */
const NOUN: Record<string, string> = { drinks: 'can', home: 'mug' };
/** The first rows only: a 4-product test. */
const LIMIT = 4;

const feedArg = (args?: string[]) => args?.find((a) => a.endsWith('.csv')) ?? FEED;
const load = (args?: string[]): Product[] => {
  const r = parseFeed(readFileSync(feedArg(args), 'utf8'));
  if (!r.ok) throw new Error(`feed rejected:\n${r.errors.join('\n')}`);
  return r.products.slice(0, LIMIT);
};

export const describe: LiveScript['describe'] = () =>
  `S19 live: ${LIMIT} products from a CSV feed -> one SAM cut-out per distinct photo, a look per product, a 4 s retail clip each, and a variant film per line. Needs META_API_KEY and SAM. Writes ${OUT}/.`;
export const estimateUsd: LiveScript['estimateUsd'] = (args) => {
  const products = load(args);
  const photos = new Set(products.map((p) => p.imageUrl)).size;
  return Math.round((photos * 0.0025 + 0.01 * 2) * 1000) / 1000; // allows two missing plates
};

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export const run: LiveScript['run'] = async ({ env, log, args }) => {
  if (!env.metaApiKey) throw new Error('META_API_KEY is required for s19-catalog');
  const products = load(args);
  const deps = await buildDeps(env);
  const film = await deps.films.create({ aspect: '9:16', title: 'Catalog test', brief: { text: 'Catalog test', productAssetId: '' }, assets: [] });
  const ctx = deps.makeToolCtx(film.id);
  mkdirSync(OUT, { recursive: true });
  const plates: Record<string, { id: string; width: number; height: number }> = existsSync(PLATES) ? JSON.parse(readFileSync(PLATES, 'utf8')) : {};
  const t0 = Date.now();
  let cost = 0;

  // one cut-out per distinct photo
  const cuts = new Map<string, { id: string; width: number; height: number }>();
  for (const photo of new Set(products.map((p) => p.imageUrl))) {
    const p = products.find((x) => x.imageUrl === photo)!;
    const noun = NOUN[p.category] ?? 'product';
    const r = await cutout(ctx, { source: readFileSync(photo), noun, sceneId: 'catalog' });
    cuts.set(photo, { id: r.cutout.id, width: r.cutout.width ?? 0, height: r.cutout.height ?? 0 });
    cost += 0.0025;
    log(`cut-out ${photo} (${noun}): ${r.cutout.id} ${r.cutout.width}x${r.cutout.height}, confidence ${r.confidence ?? 'n/a'}`);
  }

  // a look per product; a plate for each look that has none yet
  const picks = products.map((p) => {
    const cut = cuts.get(p.imageUrl)!;
    return { p, cut, pick: pickLook({ title: p.title, category: p.category, width: cut.width, height: cut.height, onSale: p.salePrice !== undefined }) };
  });
  for (const look of new Set(picks.map((x) => x.pick.look))) {
    if (LOOKS[look].plate === null || plates[look]) continue;
    const occasion = picks.find((x) => x.pick.look === look)!.pick.occasion;
    const a = await generateLookPlate(ctx, { look, occasion, productClass: 'products', aspect: '9:16', sceneId: look });
    plates[look] = { id: a.id, width: a.width ?? 720, height: a.height ?? 1280 };
    cost += 0.01;
    log(`plate for ${look}/${occasion}: ${a.id}`);
  }
  writeFileSync(PLATES, JSON.stringify(plates, null, 2));

  // a retail clip per product
  const index: Array<Record<string, unknown>> = [];
  for (const { p, cut, pick } of picks) {
    const plate = plates[pick.look];
    const clip = buildRetailClip({
      aspect: '9:16',
      look: pick.look as LookId,
      ...(plate ? { plate: { id: plate.id, src: `/api/assets/${plate.id}`, width: plate.width, height: plate.height } } : {}),
      product: { id: cut.id, src: `/api/assets/${cut.id}`, width: cut.width, height: cut.height },
      title: p.title,
      price: shownPrice(p),
      ...(p.salePrice !== undefined ? { wasPrice: p.price } : {}),
      currency: p.currency,
      accent: '#7a3b12',
    });
    const file = `${slug(p.id)}.json`;
    writeFileSync(`${OUT}/${file}`, JSON.stringify(clip));
    index.push({ id: p.id, title: p.title, price: shownPrice(p), was: p.salePrice !== undefined ? p.price : null, look: pick.look, why: pick.why, file });
    log(`${p.id}: ${pick.look} (${pick.why}), $${shownPrice(p)}${p.salePrice !== undefined ? ` (was ${p.price})` : ''} -> ${file}`);
  }

  // a variant film per line (products that share a category and a photo)
  const lines = new Map<string, typeof picks>();
  for (const x of picks) lines.set(`${x.p.category}|${x.p.imageUrl}`, [...(lines.get(`${x.p.category}|${x.p.imageUrl}`) ?? []), x]);
  for (const [key, group] of lines) {
    if (group.length < 2) continue;
    const names = variantNames(group.map((g) => g.p.title));
    const film = buildVariantFilm({
      aspect: '9:16',
      brand: group[0]!.p.title.split(/\s+/).slice(0, 2).join(' '),
      tagline: `Pick your ${group[0]!.p.category === 'home' ? 'mug' : 'favourite'}`,
      accent: '#7a3b12',
      variants: group.map((g, n) => ({ product: { id: g.cut.id, src: `/api/assets/${g.cut.id}`, width: g.cut.width, height: g.cut.height }, name: names[n]!, color: colorFor(names[n]!, n), price: shownPrice(g.p), ...(g.p.salePrice !== undefined ? { wasPrice: g.p.price } : {}), currency: g.p.currency })),
    });
    const file = `film-${slug(key.split('|')[0]!)}.json`;
    writeFileSync(`${OUT}/${file}`, JSON.stringify(film));
    index.push({ film: key.split('|')[0], variants: names, file });
    log(`variant film ${file}: ${names.join(', ')}`);
  }
  writeFileSync(`${OUT}/index.json`, JSON.stringify(index, null, 2));
  log(`done in ${Math.round((Date.now() - t0) / 1000)} s, about $${cost.toFixed(4)}; assets in ${env.DATA_DIR}/assets (copy into ./data/assets to view)`);
};
