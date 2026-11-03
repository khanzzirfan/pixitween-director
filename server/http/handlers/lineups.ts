// A catalogue is a line-up of films: every product is made by the same crew that makes one film, one product after
// another, so the films the owner watches are the films the crew made. The line-up remembers the order and the state.
import { Buffer } from 'node:buffer';
import type { Hono } from 'hono';
import { formatPrice, parseFeed, shownPrice, type Product } from '@shared/catalog';
import type { Aspect } from '@shared/composition';
import { BRIEF_MAX, newLineupId, type LineupItem } from '@shared/lineup';
import { resolvePhoto } from '../../lineup/photos';
import { activeMuseKey, rememberUserKey } from '../../credentials';
import { loadEnv } from '../../env';
import { imageSize } from '../../media/image';
import { getCrewSession } from '../../crew/run-crew';
import { cancelLineup, runLineup } from '../../lineup/runner';
import { createLineupStore, type LineupStore } from '../../lineup/store';
import type { AppDeps } from '../deps';
import { readFileSync } from 'node:fs';

const DEMO_FEED = 'fixtures/catalog/feed-6.csv';
/** Every product is a full film with a paid crew, so a line-up is kept short. */
const MAX_PRODUCTS = 12;

const isFile = (v: unknown): v is File => typeof File !== 'undefined' && v instanceof File;

/** What the crew is told about one product: the feed's facts, then the owner's words for the line-up. */
export function productBrief(p: Product, brief: string): string {
  const facts = [p.title, `${p.category}${p.brand ? ` by ${p.brand}` : ''}`, `price ${formatPrice(shownPrice(p), p.currency)}${p.salePrice !== undefined ? ` (was ${formatPrice(p.price, p.currency)})` : ''}`];
  return `${facts.join('. ')}.${brief ? ` ${brief}` : ''}`.slice(0, 2000);
}

export function registerLineupRoutes(app: Hono, deps: AppDeps): void {
  let store: LineupStore | undefined;
  const lineups = (): LineupStore => (store ??= createLineupStore({ dir: deps.dataDir ?? loadEnv().DATA_DIR }));
  app.post('/api/lineups', async (c) => {
    const form = await c.req.formData().catch(() => undefined);
    if (!form) return c.json({ error: 'bad_request', message: 'Send the feed as multipart/form-data.' }, 400);
    const demo = form.get('demo');
    const csv = form.get('csv');
    let feed: string | undefined;
    if (typeof demo === 'string' && demo) {
      if (demo !== 'feed-6') return c.json({ error: 'bad_demo', message: `unknown demo feed: ${demo}` }, 400);
      feed = readFileSync(DEMO_FEED, 'utf8');
    } else if (isFile(csv)) feed = await csv.text();
    else if (typeof csv === 'string') feed = csv;
    if (feed === undefined) return c.json({ error: 'feed_required', message: 'Send a CSV file, or the demo feed.' }, 400);
    const parsed = parseFeed(feed);
    if (!parsed.ok) return c.json({ error: 'bad_feed', errors: parsed.errors }, 400);
    if (parsed.products.length > MAX_PRODUCTS) return c.json({ error: 'too_many_products', max: MAX_PRODUCTS }, 400);
    const wanted = form.get('aspect');
    const aspect = wanted === null || wanted === '' ? '9:16' : String(wanted);
    if (aspect !== '9:16') return c.json({ error: 'bad_aspect', message: 'MuseReels makes 9:16 reels only.' }, 400);
    const rawBrief = form.get('brief');
    const brief = typeof rawBrief === 'string' ? rawBrief.trim() : '';
    if (brief.length > BRIEF_MAX) return c.json({ error: 'brief_too_long', max: BRIEF_MAX }, 400);
    const env = loadEnv();
    if (!process.env.DIRECTOR_FAKE && !activeMuseKey(env.metaApiKey)) return c.json({ error: 'meta_key_missing' }, 503);

    const uploads = new Map<string, Buffer>();
    for (const photo of form.getAll('photos')) if (isFile(photo)) uploads.set(photo.name, Buffer.from(await photo.arrayBuffer()));

    // one film per product, made now so every tab exists; a product with no photo has no film and says why
    const items: LineupItem[] = [];
    for (const product of parsed.products) {
      const photo = resolvePhoto(product.imageUrl, uploads);
      if ('error' in photo) {
        items.push({ product, state: 'failed', error: photo.error });
        continue;
      }
      try {
        const size = await imageSize(photo);
        const asset = await deps.assets.put(photo, size.mime, { role: 'product-photo', width: size.width, height: size.height });
        const film = await deps.films.create({
          aspect: aspect as Aspect,
          title: product.title,
          brief: { text: productBrief(product, brief), productAssetId: asset.id },
          ...(env.CREW_ENABLED ? { crew: true } : {}),
          assets: [asset],
        });
        rememberUserKey(deps.dataDir ?? env.DATA_DIR, film.id);
        items.push({ product, filmId: film.id, state: 'waiting' });
      } catch (e) {
        items.push({ product, state: 'failed', error: e instanceof Error ? e.message.slice(0, 200) : 'could not start this film' });
      }
    }
    if (!items.some((i) => i.filmId)) return c.json({ error: 'no_photos', message: items[0]?.error ?? 'No product had a photo.' }, 400);
    const lineup = await lineups().create({ id: newLineupId(), aspect: aspect as Aspect, createdAt: new Date().toISOString(), brief, items });

    void runLineup(deps, lineup.id, lineups()).catch((e) => console.error(`lineup ${lineup.id} failed:`, e));

    return c.json({ lineupId: lineup.id, filmIds: lineup.items.flatMap((i) => (i.filmId ? [i.filmId] : [])) }, 202);
  });

  app.post('/api/lineups/:id/stop', async (c) => {
    const id = c.req.param('id');
    const l = await lineups().get(id);
    if (!l) return c.json({ error: 'not_found' }, 404);
    const open = l.items.filter((i) => i.state === 'waiting' || i.state === 'making');
    if (!open.length) return c.json({ ok: true, stopped: false });
    cancelLineup(id);
    for (const item of open) {
      if (item.filmId) getCrewSession(item.filmId)?.stop();
      await lineups().setItem(id, item.product.id, { state: 'stopped', error: 'Stopped.' });
      if (item.state === 'making' && item.filmId) {
        await deps.films.update(item.filmId, { status: 'failed' });
        deps.makeToolCtx(item.filmId).emit({ type: 'film.status', status: 'failed' });
      }
    }
    return c.json({ ok: true, stopped: true });
  });

  app.get('/api/lineups/:id', async (c) => {
    const l = await lineups().get(c.req.param('id'));
    if (!l) return c.json({ error: 'not_found' }, 404);
    return c.json(l);
  });
}
