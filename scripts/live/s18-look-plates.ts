// S18 live: one real Muse plate per look recipe (docs/direction/corpus/02-looks.md), written from lookPlatePrompt, so the retail
// clip can be judged on real themed worlds. Paid, so it prints an estimate and exits unless --yes is passed. Writes
// web/public/cartoon/look-plates.json (look -> plate asset); copy the plate files into ./data/assets to view them.
import { writeFileSync } from 'node:fs';
import { LOOKS, lookPlatePrompt, type LookId, type OccasionId } from '../../server/authoring/looks';
import { generateLookPlate } from '../../server/art/stills';
import { buildDeps } from '../../server/main';
import type { LiveScript } from './run';

/** Each look on the occasion that shows it best; the promo draws its own world and needs no plate. */
export const PLAN: Array<{ look: LookId; occasion: OccasionId }> = [
  { look: 'tabletop-hero', occasion: 'everyday' },
  { look: 'flat-lay', occasion: 'party' },
  { look: 'studio-pedestal', occasion: 'premium' },
  { look: 'lifestyle-room', occasion: 'festive' },
  { look: 'ingredient-orbit', occasion: 'summer' },
];

export const describe: LiveScript['describe'] = () =>
  `S18 live: ${PLAN.length} Muse plates, one per look (${PLAN.map((p) => `${p.look}/${p.occasion}`).join(', ')}), 9:16, product class "cans". Needs META_API_KEY. Writes web/public/cartoon/look-plates.json.`;
export const estimateUsd: LiveScript['estimateUsd'] = () => PLAN.length * 0.01;

export const run: LiveScript['run'] = async ({ env, log }) => {
  if (!env.metaApiKey) throw new Error('META_API_KEY is required for s18-look-plates');
  const deps = await buildDeps(env);
  const film = await deps.films.create({ aspect: '9:16', title: 'Look plates', brief: { text: 'Plates for the retail clip looks', productAssetId: '' }, assets: [] });
  const ctx = deps.makeToolCtx(film.id);
  const out: Record<string, { id: string; url: string; width?: number; height?: number; occasion: OccasionId; prompt: string }> = {};
  const t0 = Date.now();
  const results = await Promise.allSettled(
    PLAN.map(async ({ look, occasion }) => {
      if (LOOKS[look].plate === null) return;
      const prompt = lookPlatePrompt(look, { occasion, productClass: 'cans', aspect: '9:16' })!;
      const a = await generateLookPlate(ctx, { look, occasion, productClass: 'cans', aspect: '9:16', sceneId: look });
      out[look] = { id: a.id, url: a.url, ...(a.width ? { width: a.width } : {}), ...(a.height ? { height: a.height } : {}), occasion, prompt };
    }),
  );
  results.forEach((r, i) => log(`${PLAN[i]!.look}: ${r.status === 'fulfilled' ? `ok ${out[PLAN[i]!.look]?.id}` : `FAILED - ${String(r.reason).slice(0, 300)}`}`));
  writeFileSync('web/public/cartoon/look-plates.json', JSON.stringify(out, null, 2));
  log(`wrote web/public/cartoon/look-plates.json (${Object.keys(out).length} plates) in ${Math.round((Date.now() - t0) / 1000)} s; assets are in ${env.DATA_DIR}/assets`);
};
