import { readFile } from 'node:fs/promises';
import type { FilmStore } from '@shared/ports';
import type { ToolCtx } from '@shared/tools';
import { registerAsset } from '../authoring/api';
import { finishComposition } from '../authoring/finish';
import type { Comp, Obj } from '../authoring/types';
import { bestFlatTextColor } from '../review/contrast';
import { listScenes, runRules } from '../review/rules';
import { settleTextBoxes } from './text-lane';

/**
 * Text the contrast rule still fails on the finished film, read against the real plate pixels, gets the flat colour that reads
 * best there; where even that falls short of 4.5:1, an outline in the opposite colour carries it. Runs last, so no later edit undoes it.
 */
export async function settleContrast(c: Comp, assets: Pick<ToolCtx['assets'], 'read'>): Promise<{ comp: Comp; fixed: string[] }> {
  const { findings } = await runRules(c, { read: (id: string) => assets.read(id) });
  const out = structuredClone(c);
  const fixed: string[] = [];
  // the finish's own layers (the price badge) sit on their own colour, not the plate the rule reads
  for (const f of findings.filter((x) => x.rule === 'R3' && x.kind === 'low-contrast' && x.layerId && !x.layerId.startsWith('finish:'))) {
    const lum = Number(f.metrics?.plateLuminance);
    if (!Number.isFinite(lum)) continue;
    const layer = Object.values((out.precomps ?? {}) as Record<string, Obj>)
      .flatMap((p) => p.layers as Obj[])
      .find((l) => l.id === f.layerId);
    if (!layer?.style) continue;
    const best = bestFlatTextColor(lum);
    layer.style.fill = best.color;
    if (!best.reaches) {
      const size = typeof layer.style.size === 'number' ? layer.style.size : 80;
      layer.style.stroke = { color: best.color === '#FFFFFF' ? '#111111' : '#FFFFFF', width: Math.max(3, Math.round(size * 0.05)) };
    }
    fixed.push(f.layerId!);
  }
  return { comp: fixed.length ? out : c, fixed };
}

/** The 2D film as the finish would make it (shadow, grade, type, music), without committing it. Nothing when the film has no composition. */
export async function finishedComposition(films: FilmStore, filmId: string, assets: ToolCtx['assets']): Promise<Comp | undefined> {
  const film = await films.get(filmId);
  if (!film.composition) return undefined;
  let comp = film.composition as Comp;
  const held = (comp.layers as Obj[]).find((l) => l.id === 'finish:music')?.assetId as string | undefined;
  let musicAssetId = held && comp.assets[held] ? held : undefined;
  if (!musicAssetId) {
    const ref = await assets.put(await readFile(new URL('./media/bed.wav', import.meta.url)), 'audio/wav', { role: 'audio' });
    comp = registerAsset(comp, { id: ref.id, kind: 'audio', src: ref.url, duration: comp.durationInFrames });
    musicAssetId = ref.id;
  }
  // every box behind words is tied to them once more, after the last edit of any scene
  for (const s of listScenes(comp)) comp = settleTextBoxes(comp, s.sceneId).comp;
  const finished = finishComposition(comp, { musicAssetId, brief: film.brief.text, ...(film.styleBible?.palette[0] ? { accent: film.styleBible.palette[0] } : {}) });
  return (await settleContrast(finished, assets).catch(() => ({ comp: finished, fixed: [] as string[] }))).comp;
}

/** The last step of a crew film: shadow, grade, type and the music bed, committed as one version. Never throws: a film without the polish still ships. */
export async function finishFilm(films: FilmStore, filmId: string, assets: ToolCtx['assets']): Promise<void> {
  try {
    const comp = await finishedComposition(films, filmId, assets);
    if (comp) await films.commit(filmId, comp, 'director', 'finish: shadow, grade, type, music');
  } catch {
    /* the film is already built; the polish is optional */
  }
}
