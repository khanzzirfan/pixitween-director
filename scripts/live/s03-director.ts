import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createDirector } from '../../server/agent/director';
import { buildDeps } from '../../server/main';
import { newFilmComposition, summariseComposition } from '../../server/authoring/api';
import type { LiveScript } from './run';

export const describe: LiveScript['describe'] = () => 'Runs the real director (Spark storyboard + tool loop) on fixtures/seed/mug-product.png with a typed brief and writes debug/s03/iteration-NN/{storyboard.json,composition.json,events.jsonl,summary.md}.';
export const estimateUsd: LiveScript['estimateUsd'] = () => 0.2;
export const run: LiveScript['run'] = async ({ env, log }) => {
  if (!env.metaApiKey) throw new Error('META_API_KEY is required for s03-director');
  const deps = await buildDeps(env);
  const photo = readFileSync(new URL('../../fixtures/seed/mug-product.png', import.meta.url));
  const asset = await deps.assets.put(photo, 'image/png', { role: 'product-photo' });
  const film = await deps.films.create({ aspect: '16:9', title: 'Morning Ritual', brief: { text: 'A 12 second ad for our white ceramic mug: calm sunrise mornings, end on the mug.', productAssetId: asset.id }, assets: [asset] });
  const dir = join('debug', 's03'); mkdirSync(dir, { recursive: true });
  const next = readdirSync(dir).filter((n) => /^iteration-\d+$/.test(n)).length + 1;
  const out = join(dir, `iteration-${String(next).padStart(2, '0')}`); mkdirSync(out, { recursive: true });
  const events: string[] = []; deps.bus.subscribe(film.id, (event) => events.push(JSON.stringify(event.event)));
  await createDirector(deps).runDirector(film.id);
  const ready = await deps.films.get(film.id);
  const composition = ready.composition ?? newFilmComposition({ aspect: ready.aspect });
  writeFileSync(join(out, 'storyboard.json'), JSON.stringify(ready.storyboard ?? null, null, 2));
  writeFileSync(join(out, 'composition.json'), JSON.stringify(composition, null, 2));
  writeFileSync(join(out, 'events.jsonl'), events.join('\n') + (events.length ? '\n' : ''));
  writeFileSync(join(out, 'summary.md'), `# ${ready.title ?? 'Film'}\n\n${summariseComposition(composition)}\n\nVersion ${ready.version}; cost $${ready.costUsd.toFixed(4)}; status ${ready.status}.\n`);
  log(`film ${film.id}: ${ready.status}, version ${ready.version}, $${ready.costUsd.toFixed(4)}`);
};
void existsSync;
