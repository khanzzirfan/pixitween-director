import { expect, it } from 'vitest';
import { addScene, newFilmComposition, registerAsset } from '../authoring/api';
import type { Scene } from '@shared/storyboard';
import { makeTestFilm } from '../test-utils/film';
import { ensureSceneBasics, PLACEHOLDER_TEXT } from './scene-basics';

const scene = (id: string, mode: Scene['mode']): Scene => ({ id, durationSec: 3, intent: 'fine mist spraying', shotType: 'lifestyle', camera: 'static', layersWanted: ['bg', 'product'], mode, modeReason: 'r' });

async function filmWith(mode: 'motion' | 'generate') {
  const t = await makeTestFilm({ aspect: '9:16' });
  const productId = (await t.films.get(t.filmId)).brief.productAssetId;
  let c = newFilmComposition({ aspect: '9:16', title: 'T', palette: ['#180d0a'] });
  c = registerAsset(c, { id: productId, kind: 'image', src: `/api/assets/${productId}`, width: 64, height: 64 });
  c = addScene(c, { id: 'mist', durationSec: 3, mode });
  await t.films.commit(t.filmId, c, 'user');
  return { ...t, productId };
}
const layers = async (t: Awaited<ReturnType<typeof filmWith>>) => ((await t.films.get(t.filmId)).composition!.precomps as Record<string, { layers: Array<Record<string, any>> }>).mist!.layers;

it('a generate scene waiting for approval is a dimmed full-frame poster with a small caption, and no loose product rectangle', async () => {
  const t = await filmWith('generate');
  await ensureSceneBasics({ ctx: t.ctx, scene: scene('mist', 'generate'), product: { assetId: t.productId }, palette: ['#180d0a'] });
  const ls = await layers(t);
  expect(ls.map((l) => l.id)).toEqual(['mist:bg', 'mist:caption']);
  const bg = ls.find((l) => l.id === 'mist:bg')!;
  expect(bg).toMatchObject({ kind: 'image', assetId: t.productId });
  expect(bg.transform.opacity).toBeLessThan(0.7);
  const caption = ls.find((l) => l.id === 'mist:caption')!;
  expect(caption.source).toBe(PLACEHOLDER_TEXT);
  expect(caption.style.size).toBeLessThan(0.04 * 1920); // a label, smaller than a headline
});

it('a motion scene still gets a shape background and the product layer', async () => {
  const t = await filmWith('motion');
  await ensureSceneBasics({ ctx: t.ctx, scene: scene('mist', 'motion'), product: { assetId: t.productId }, palette: ['#180d0a'] });
  const ls = await layers(t);
  expect(ls.map((l) => [l.id, l.kind])).toEqual([['mist:bg', 'shape'], ['mist:product', 'image']]);
});
