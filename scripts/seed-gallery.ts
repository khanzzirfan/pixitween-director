// Loads the demo films from fixtures/s08a/seed-films into the data stores: `npx tsx scripts/seed-gallery.ts [--force]`.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { AepCompositionJson } from 'reacthub-pixitweenjs';
import type { FilmState } from '@shared/composition';
import type { AssetStore, FilmStore } from '@shared/ports';

export interface SeedFile {
  film: Record<string, any> & { composition: AepCompositionJson };
  assets: Array<{ key: string; file: string; mime: string; role?: string }>;
}

const TOKEN = /\{\{asset:([\w-]+)\}\}/g;

/** Pure: replaces every {{asset:<key>}} token with urlFor(key). */
export function prepareSeed(seed: SeedFile, urlFor: (key: string) => string): { init: Record<string, any>; composition: AepCompositionJson; storyboard: FilmState['storyboard']; title: string } {
  const film = JSON.parse(JSON.stringify(seed.film).replace(TOKEN, (_m, key: string) => urlFor(key))) as SeedFile['film'];
  const { composition, status: _status, ...init } = film;
  return { init, composition, storyboard: film.storyboard, title: film.title };
}

export async function runSeed(opts: { films: FilmStore; assets: AssetStore; seedDir: string; force?: boolean; log?: (m: string) => void }): Promise<{ created: number; skipped: number }> {
  const log = opts.log ?? (() => undefined);
  let created = 0;
  let skipped = 0;
  const existing = await opts.films.list();

  for (const name of readdirSync(opts.seedDir).sort()) {
    const dir = join(opts.seedDir, name);
    const file = join(dir, 'seed.json');
    if (!existsSync(file)) continue;
    const seed = JSON.parse(readFileSync(file, 'utf8')) as SeedFile;
    if (!opts.force && existing.some((f) => f.title === seed.film.title)) {
      log(`already seeded: ${seed.film.title}`);
      skipped++;
      continue;
    }
    const refs = new Map<string, Awaited<ReturnType<AssetStore['put']>>>();
    for (const a of seed.assets) refs.set(a.key, await opts.assets.put(readFileSync(resolve(dir, a.file)), a.mime, a.role ? { role: a.role as never } : {}));
    const { init, composition, storyboard, title } = prepareSeed(seed, (key) => opts.assets.url(refs.get(key)!.id));
    const productKey = Object.keys(Object.fromEntries(refs))[0]!;
    const film = await opts.films.create({ ...init, brief: { ...(init.brief as object), productAssetId: refs.get(productKey)!.id }, assets: [...refs.values()] } as never);
    const r = await opts.films.commit(film.id, composition, 'director', 'seed');
    if (!r.ok) throw new Error(`seed composition for '${title}' is invalid: ${JSON.stringify(r.issues)}`);
    await opts.films.update(film.id, { status: 'ready', storyboard, title });
    log(`seeded: ${title}`);
    created++;
  }
  return { created, skipped };
}

async function main(): Promise<void> {
  const { loadEnv } = await import('../server/env');
  const { getValidator } = await import('../server/engine/validate');
  const { createAssetStore } = await import('../server/store/asset-store');
  const { createFilmStore } = await import('../server/store/film-store');
  if (existsSync('.env')) process.loadEnvFile('.env');
  const env = loadEnv();
  const films = createFilmStore({ dir: env.DATA_DIR, validator: await getValidator() });
  const assets = createAssetStore({ dir: env.DATA_DIR, publicBaseUrl: env.PUBLIC_BASE_URL, maxUploadBytes: env.MAX_UPLOAD_MB * 1024 * 1024 });
  const seedDir = fileURLToPath(new URL('../fixtures/s08a/seed-films', import.meta.url));
  const r = await runSeed({ films, assets, seedDir, force: process.argv.includes('--force'), log: console.log });
  console.log(`created ${r.created}, skipped ${r.skipped}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) void main();
