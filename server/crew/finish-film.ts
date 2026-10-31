import { readFile } from 'node:fs/promises';
import type { FilmStore } from '@shared/ports';
import type { ToolCtx } from '@shared/tools';
import { registerAsset } from '../authoring/api';
import { finishComposition } from '../authoring/finish';
import type { Comp, Obj } from '../authoring/types';

/** The last step of a crew film: shadow, grade, type and the music bed, committed as one version. Never throws: a film without the polish still ships. */
export async function finishFilm(films: FilmStore, filmId: string, assets: ToolCtx['assets']): Promise<void> {
  try {
    const film = await films.get(filmId);
    if (!film.composition) return;
    let comp = film.composition as Comp;
    const held = (comp.layers as Obj[]).find((l) => l.id === 'finish:music')?.assetId as string | undefined;
    let musicAssetId = held && comp.assets[held] ? held : undefined;
    if (!musicAssetId) {
      const ref = await assets.put(await readFile(new URL('./media/bed.wav', import.meta.url)), 'audio/wav', { role: 'audio' });
      comp = registerAsset(comp, { id: ref.id, kind: 'audio', src: ref.url, duration: comp.durationInFrames });
      musicAssetId = ref.id;
    }
    await films.commit(filmId, finishComposition(comp, { musicAssetId, brief: film.brief.text }), 'director', 'finish: shadow, grade, type, music');
  } catch {
    /* the film is already built; the polish is optional */
  }
}
