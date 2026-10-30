import type { ToolCtx } from '@shared/tools';
import type { Scene } from '@shared/storyboard';
import { layerIdsByRole, markPlaceholder } from '../authoring/api';
import { runTool } from '../tools/registry';

export const PLACEHOLDER_TEXT = 'Clip pending approval';
/** The poster of a generate scene is dimmed so the small caption on it reads. */
const POSTER_OPACITY = 0.55;
/** The placeholder caption is a quiet label, not a headline: this share of the frame height. */
const PLACEHOLDER_SIZE = 0.024;

export async function ensureSceneBasics(o: {
  ctx: ToolCtx;
  scene: Scene;
  product: { assetId: string };
  palette: string[];
}): Promise<{ added: string[] }> {
  const added: string[] = [];
  let film = await o.ctx.films.get(o.ctx.filmId);
  let comp = film.composition;
  if (!comp) return { added };
  const add = async (args: Record<string, unknown>) => {
    const result = await runTool(o.ctx, 'addLayer', args);
    if (!result.ok) return;
    const data = result.data as { layerId?: string } | undefined;
    if (data?.layerId) added.push(data.layerId);
    film = await o.ctx.films.get(o.ctx.filmId);
    comp = film.composition;
  };
  const pending = o.scene.mode === 'generate';
  if (!layerIdsByRole(comp, 'bg', o.scene.id).length) {
    // a scene waiting for its clip shows the product photo full frame and dimmed, a poster, not a loose photo rectangle
    if (pending) {
      await add({ sceneId: o.scene.id, role: 'bg', kind: 'image', assetId: o.product.assetId });
      const poster = added.at(-1);
      if (poster) await runTool(o.ctx, 'setTransform', { layerId: poster, opacity: POSTER_OPACITY });
      film = await o.ctx.films.get(o.ctx.filmId);
      comp = film.composition;
    } else await add({ sceneId: o.scene.id, role: 'bg', kind: 'shape', fill: o.palette[0] ?? '#111827' });
  }
  if (!pending && comp && !layerIdsByRole(comp, 'product', o.scene.id).length && !layerIdsByRole(comp, 'product3d', o.scene.id).length)
    await add({ sceneId: o.scene.id, role: 'product', kind: 'image', assetId: o.product.assetId });
  if (comp && o.scene.text && !layerIdsByRole(comp, 'headline', o.scene.id).length)
    await add({ sceneId: o.scene.id, role: 'headline', kind: 'text', text: o.scene.text, style: { color: '#ffffff' } });
  if (comp && o.scene.mode === 'generate') {
    const currentComp = comp;
    const existingCaption = layerIdsByRole(currentComp, 'caption', o.scene.id).find((id) => {
      const inner = currentComp.precomps?.[o.scene.id] as { layers?: Array<{ id: string; source?: string }> } | undefined;
      return inner?.layers?.some((l) => l.id === id && l.source === PLACEHOLDER_TEXT);
    });
    if (!existingCaption) {
      await add({ sceneId: o.scene.id, role: 'caption', kind: 'text', text: PLACEHOLDER_TEXT, style: { size: Math.round(currentComp.height * PLACEHOLDER_SIZE), weight: 500, color: '#ffffff' } });
      if (added.length) {
        film = await o.ctx.films.get(o.ctx.filmId);
        const id = added.at(-1)!;
        if (film.composition) {
          const next = markPlaceholder(film.composition, id, true);
          await o.ctx.films.commit(o.ctx.filmId, next, 'director', 'mark generate placeholder');
        }
      }
    }
  }
  return { added };
}
