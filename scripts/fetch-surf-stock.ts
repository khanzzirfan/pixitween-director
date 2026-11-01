// Stock photos for the summer surf demo feed (fixtures/catalog/feed-summer-surf.csv): one free photo per product, picked by hand from
// Pexels (PEXELS_API_KEY) and Pixabay (PIXABAY_KEY). Free to run: it only downloads. Each photo is looked up by its id, so the same
// photo comes back every time, saved to fixtures/catalog/surf/ with a CREDITS.md naming the photographer and the page.
// Usage: npx tsx scripts/fetch-surf-stock.ts
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

for (const file of ['.env.dev', '.env']) if (existsSync(file)) process.loadEnvFile(file);

const OUT = 'fixtures/catalog/surf';

interface Pick {
  /** The product id of the feed: the photo is saved as `<product>.jpg`. */
  product: string;
  source: 'pexels' | 'pixabay';
  /** The photo's id on its site. */
  id: number;
  /** What the photo shows, for the credits. */
  shows: string;
}
const PICKS: Pick[] = [
  { product: 'surf-longboard', source: 'pexels', id: 19563441, shows: 'two surfboards on a sandy beach' },
  { product: 'surf-shortboard', source: 'pexels', id: 14674999, shows: 'three surfboards on a white wall' },
  { product: 'beach-towel', source: 'pexels', id: 31789278, shows: 'a rolled striped towel on a pool edge' },
  { product: 'swim-goggles', source: 'pexels', id: 29266554, shows: 'swimming goggles on a sandy beach' },
  { product: 'sun-cooler', source: 'pixabay', id: 5312095, shows: 'a blue cooler box on the grass by the water' },
];

interface Found {
  url: string;
  page: string;
  by: string;
}

async function pexels(id: number): Promise<Found | undefined> {
  const res = await fetch(`https://api.pexels.com/v1/photos/${id}`, { headers: { Authorization: process.env.PEXELS_API_KEY ?? '' } });
  if (!res.ok) return undefined;
  const p = (await res.json()) as { src: { large: string }; url: string; photographer: string };
  return { url: p.src.large, page: p.url, by: p.photographer };
}

async function pixabay(id: number): Promise<Found | undefined> {
  const res = await fetch(`https://pixabay.com/api/?key=${process.env.PIXABAY_KEY ?? ''}&id=${id}`);
  if (!res.ok) return undefined;
  const p = ((await res.json()) as { hits?: Array<{ largeImageURL: string; pageURL: string; user: string }> }).hits?.[0];
  return p ? { url: p.largeImageURL, page: p.pageURL, by: p.user } : undefined;
}

mkdirSync(OUT, { recursive: true });
const credits = ['# Surf demo photos', '', 'Free stock photos used by `feed-summer-surf.csv`. Fetched by `scripts/fetch-surf-stock.ts`.', ''];
let missing = 0;
for (const pick of PICKS) {
  const found = await (pick.source === 'pexels' ? pexels(pick.id) : pixabay(pick.id));
  const res = found ? await fetch(found.url) : undefined;
  if (!found || !res?.ok) {
    console.log(`${pick.product}: could not get ${pick.source} photo ${pick.id}`);
    missing += 1;
    continue;
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  writeFileSync(`${OUT}/${pick.product}.jpg`, bytes);
  credits.push(`- \`${pick.product}.jpg\`: ${pick.shows}, by ${found.by} on ${pick.source === 'pexels' ? 'Pexels' : 'Pixabay'}, ${found.page}`);
  console.log(`${pick.product}: ${pick.source} ${pick.id}, ${Math.round(bytes.length / 1024)} KB`);
}
writeFileSync(`${OUT}/CREDITS.md`, `${credits.join('\n')}\n`);
if (missing) process.exitCode = 1;
