import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { lightValidate } from '../server/engine/light-validator';
import { makeTestFilm } from '../server/test-utils/film';
import { prepareSeed, runSeed, type SeedFile } from './seed-gallery';

const seedDir = new URL('../fixtures/s08a/seed-films', import.meta.url).pathname;
const seed = JSON.parse(readFileSync(`${seedDir}/demo-mug/seed.json`, 'utf8')) as SeedFile;

it('prepareSeed leaves no placeholder', () => {
  const out = prepareSeed(seed, (k) => `/api/assets/${k}`);
  expect(JSON.stringify(out)).not.toContain('{{asset:');
  expect(out.composition.assets.mug!.src).toBe('/api/assets/mug-product');
});

it('seeds a ready film, skips on rerun and recreates with force', async () => {
  const t = await makeTestFilm();
  const run = (force = false) => runSeed({ films: t.films, assets: t.assets, seedDir, force });
  expect(await run()).toEqual({ created: 1, skipped: 0 });
  const seeded = (await t.films.list()).filter((f) => f.status === 'ready');
  expect(seeded).toHaveLength(1);
  expect(lightValidate(seeded[0]!.composition).ok).toBe(true);
  expect((await t.assets.read(seeded[0]!.brief.productAssetId)).equals(readFileSync(new URL('../fixtures/seed/mug-product.png', import.meta.url)))).toBe(true);
  expect(await run()).toEqual({ created: 0, skipped: 1 });
  expect(await run(true)).toEqual({ created: 1, skipped: 0 });
});
