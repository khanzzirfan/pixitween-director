// S20 live: the cinematic catalogue, board first. For each tall round product in a CSV feed:
//   1. Muse looks at the product photo and writes a BOARD: a concept, the elements that belong round this product (beans, a splash, a lemon
//      slice...), and the shot list that uses them. Saved in web/public/cartoon/catalog-cine/boards.json, one per product, about $0.005 each.
//   2. Each element is drawn once as a cut-out sheet (one Muse picture, one SAM call, every piece cut out) and kept in
//      web/public/cartoon/ingredients.json, about $0.0125 an element, nothing for glass or for an element already drawn.
//   3. The film is built from the board as one stage3d world (schema 1.12.0, engine aep-32) into catalog-cine/<id>.json.
// `--board` stops after step 1 so a person can read the boards before any picture is paid for; the next run reuses the saved boards.
// Paid, so it prints an estimate and exits unless --yes is passed. Use its own DATA_DIR.
// Usage: npm run live -- s20-cinematic [feed.csv] [--board] [--yes]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { shownPrice, parseFeed, type Product } from '../../shared/catalog';
import { cutout } from '../../server/art/cutout';
import { dominantAccent } from '../../server/art/palette';
import { checkBeatSheet, planBoard, reviewBoard, totalSeconds, type CinematicBoard } from '../../server/authoring/beatsheet';
import { prepareRound } from '../../server/authoring/catalog-clip';
import { buildCinematicFilm } from '../../server/authoring/cinematic-film';
import { elementCostUsd, elementKey, makeElement, type ElementSpec, type IngredientAsset } from '../../server/authoring/ingredients';
import { newPrepareCache } from '../../server/product3d/prepare';
import { buildDeps } from '../../server/main';
import type { LiveScript } from './run';

const FEED = 'fixtures/catalog/feed-6.csv';
const OUT = 'web/public/cartoon/catalog-cine';
const BOARDS = `${OUT}/boards.json`;
const REGISTRY = 'web/public/cartoon/ingredients.json';
const NOUN: Record<string, string> = { drinks: 'can', home: 'mug' };
const FALLBACK_ACCENT = '#3d4a5c';
/** What one board costs to ask for and, as a ceiling before the board is known, what its elements may cost. */
const BOARD_USD = 0.005;
const ELEMENTS_CEILING = 4;

interface SavedBoard extends CinematicBoard {
  source: 'muse' | 'floor';
  violations: string[];
  dropped: string[];
}
type Boards = Record<string, SavedBoard>;

const feedArg = (args?: string[]) => args?.find((a) => a.endsWith('.csv')) ?? FEED;
const load = (args?: string[]): Product[] => {
  const r = parseFeed(readFileSync(feedArg(args), 'utf8'));
  if (!r.ok) throw new Error(`feed rejected:\n${r.errors.join('\n')}`);
  return r.products;
};
const readJson = <T>(file: string, empty: T): T => (existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as T) : empty);
/** Only the products the cinematic film suits: a class SAM and 3D know as round (a can). */
/** A saved board needs Muse again when it was a floor fallback or fails the checker now (a person may have edited it, or the rules grew). */
const needsPlanning = (b: SavedBoard | undefined): string[] | null => {
  if (!b) return [];
  if (b.source === 'floor') return b.violations;
  const v = reviewBoard(b).violations;
  return v.length ? v : null;
};
const roundNoun = (p: Product) => (NOUN[p.category] ?? 'product') === 'can';

export const describe: LiveScript['describe'] = () =>
  `S20 live: tall round products of a CSV feed (default ${FEED}) -> Muse looks at each photo and writes a board (concept, elements, shots) -> each element drawn once as a cut-out sheet -> one cinematic stage3d film each. --board stops after the boards. Needs META_API_KEY, SAM and Spark. Writes ${OUT}/ and ${REGISTRY}.`;
export const estimateUsd: LiveScript['estimateUsd'] = (args) => {
  const round = load(args).filter(roundNoun);
  const boards = readJson<Boards>(BOARDS, {});
  const unplanned = round.filter((p) => needsPlanning(boards[p.id]) !== null);
  const boardsUsd = unplanned.length * BOARD_USD;
  if (args?.includes('--board')) return Math.round(boardsUsd * 10000) / 10000;
  const photos = new Set(round.map((p) => p.imageUrl)).size;
  const made = new Set(Object.keys(readJson<Record<string, IngredientAsset>>(REGISTRY, {})));
  const known = new Map<string, ElementSpec>();
  for (const p of round) for (const e of boards[p.id]?.elements ?? []) known.set(elementKey(e), e);
  // a product with no board yet may bring up to ELEMENTS_CEILING new elements
  const elementsUsd = elementCostUsd([...known.values()], made) + unplanned.length * ELEMENTS_CEILING * 0.0125;
  return Math.round((boardsUsd + photos * 0.0025 + elementsUsd) * 10000) / 10000;
};

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export const run: LiveScript['run'] = async ({ env, log, args }) => {
  if (!env.metaApiKey) throw new Error('META_API_KEY is required for s20-cinematic');
  const products = load(args).filter(roundNoun);
  if (!products.length) throw new Error('the feed has no round products (cans) for the cinematic film');
  const deps = await buildDeps(env);
  const film = await deps.films.create({ aspect: '9:16', title: 'Cinematic catalog', brief: { text: 'Cinematic catalog', productAssetId: '' }, assets: [] });
  const ctx = deps.makeToolCtx(film.id);
  mkdirSync(OUT, { recursive: true });
  const t0 = Date.now();
  let cost = 0;

  // 1. the boards: Muse looks at each product photo
  const boards = readJson<Boards>(BOARDS, {});
  for (const p of products) {
    const redo = needsPlanning(boards[p.id]);
    if (redo !== null) {
      // a saved board that fails the checker goes back to Muse with its broken rules and the board itself, to be mended
      const prior = boards[p.id] && redo.length ? { prior: { board: boards[p.id]!, violations: redo } } : {};
      if (prior.prior) log(`board ${p.id} no longer passes (${redo.join('; ')}); asking Muse to mend it`);
      const planned = await planBoard(ctx, { title: p.title, ...(p.brand ? { brand: p.brand } : {}), category: p.category, photo: readFileSync(p.imageUrl), ...prior });
      cost += BOARD_USD;
      boards[p.id] = { ...planned.board, source: planned.source, violations: planned.violations, dropped: planned.dropped };
      writeFileSync(BOARDS, JSON.stringify(boards, null, 2));
    }
    const b = boards[p.id]!;
    log(`board ${p.id} (by ${b.source}${b.violations.length ? `, Muse's broke: ${b.violations.join('; ')}` : ''}): ${b.concept} [${b.mood}]`);
    log(`  elements: ${b.elements.map((e) => `${e.id} (${e.glass ? 'glass' : e.use}${e.pieces > 1 ? ` x${e.pieces}` : ''}: ${e.look})`).join('; ')}`);
    log(`  shots: ${b.sheet.beats.map((x) => `${x.seconds}s ${x.size} ${x.move}${x.ingredient ? ` +${x.ingredient.kind}:${x.ingredient.action}` : ''}`).join(' | ')}`);
    if (b.dropped.length) log(`  dropped: ${b.dropped.join('; ')}`);
  }
  if (args?.includes('--board')) {
    log(`boards done in ${Math.round((Date.now() - t0) / 1000)} s, about $${cost.toFixed(4)}; read ${BOARDS}, then run again without --board to draw the elements and build the films`);
    return;
  }

  // 2. the elements, each drawn once as a cut-out sheet
  const reg = readJson<Record<string, IngredientAsset>>(REGISTRY, {});
  const prepCache = newPrepareCache();
  for (const p of products) {
    for (const e of boards[p.id]!.elements) {
      const key = elementKey(e);
      if (reg[key]) continue;
      try {
        reg[key] = await makeElement(ctx, e, { cache: prepCache });
        cost += e.glass ? 0 : 0.0125;
        log(`element ${e.id} (${key}): ${reg[key]!.frames.map((f) => f.id).join(', ') || 'glass, no picture'}`);
        writeFileSync(REGISTRY, JSON.stringify(reg, null, 2));
      } catch (err) {
        // the picture and the SAM tries are paid even when the cut fails
        cost += e.glass ? 0 : 0.01 + 0.0025 * 3;
        // the film plays without an element it could not draw; the board keeps it so a rerun tries again
        log(`element ${e.id} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // 3. one cut-out per distinct photo, its 3D label and the colour the photo carries
  const cuts = new Map<string, { id: string; width: number; height: number; accent: string; chroma: number; prep: Awaited<ReturnType<typeof prepareRound>> }>();
  for (const photo of new Set(products.map((p) => p.imageUrl))) {
    const r = await cutout(ctx, { source: readFileSync(photo), noun: 'can', sceneId: 'catalog' });
    cost += 0.0025;
    const dir = [`${env.DATA_DIR}/assets`, './data/assets'].find((d) => existsSync(`${d}/${r.cutout.id}.png`));
    const acc = dir ? await dominantAccent(readFileSync(`${dir}/${r.cutout.id}.png`)) : { hex: FALLBACK_ACCENT, chroma: 0 };
    const c = { id: r.cutout.id, width: r.cutout.width ?? 0, height: r.cutout.height ?? 0 };
    cuts.set(photo, { ...c, accent: acc.hex, chroma: acc.chroma, prep: await prepareRound(deps.assets, c, 'can', prepCache) });
    log(`cut-out ${photo}: ${c.id} ${c.width}x${c.height}, photo colour ${acc.hex}, 3D label ${cuts.get(photo)!.prep ? 'ok' : 'none (not a straight can)'}`);
  }

  // 4. the films
  const index: Array<Record<string, unknown>> = [];
  for (const p of products) {
    const cut = cuts.get(p.imageUrl)!;
    const b = boards[p.id]!;
    if (!cut.prep || cut.prep.shape === 'other') {
      log(`${p.id}: skipped, no 3D label for its photo`);
      continue;
    }
    const t = cut.prep.texture;
    const ingredients = Object.fromEntries(b.elements.filter((e) => reg[elementKey(e)]).map((e) => [e.id, { ...reg[elementKey(e)]!, kind: e.id }]));
    const clip = buildCinematicFilm({
      aspect: '9:16',
      sheet: b.sheet,
      ...(b.tone ? { tone: b.tone } : {}),
      ...(b.key ? { key: b.key } : {}),
      texture: { id: t.id, src: `/api/assets/${t.id}`, width: t.width ?? 2048, height: t.height ?? 1024, kind: cut.prep.textureKind },
      shape: cut.prep.shape,
      side: cut.prep.side,
      productAspect: cut.prep.aspect,
      title: p.title,
      price: shownPrice(p),
      ...(p.salePrice !== undefined ? { wasPrice: p.price } : {}),
      currency: p.currency,
      ...(p.brand ? { brand: p.brand } : {}),
      accent: cut.chroma > 0.05 ? cut.accent : FALLBACK_ACCENT,
      ingredients,
    });
    const file = `${slug(p.id)}.json`;
    writeFileSync(`${OUT}/${file}`, JSON.stringify(clip));
    index.push({ id: p.id, title: p.title, price: shownPrice(p), was: p.salePrice !== undefined ? p.price : null, concept: b.concept, mood: b.mood, boardSource: b.source, elements: b.elements.map((e) => ({ id: e.id, name: e.name, drawn: e.glass || !!reg[elementKey(e)] })), seconds: totalSeconds(b.sheet), sheet: b.sheet, file });
    log(`${p.id}: ${b.sheet.beats.length} shots, ${totalSeconds(b.sheet)} s, ${Object.keys(ingredients).length}/${b.elements.length} elements drawn; rule breaks left ${checkBeatSheet(b.sheet, b.elements).length} -> ${file}`);
  }
  writeFileSync(`${OUT}/index.json`, JSON.stringify(index, null, 2));
  log(`done in ${Math.round((Date.now() - t0) / 1000)} s, about $${cost.toFixed(4)}; assets in ${env.DATA_DIR}/assets (copy into ./data/assets to view)`);
};
