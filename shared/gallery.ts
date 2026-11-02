// What the gallery needs of a film: a few fields, not its composition. The server builds these for GET /api/gallery so a grid of films
// does not carry every film's full composition over the wire.
import type { FilmState } from './composition';

export interface GallerySummary {
  id: string;
  title: string;
  aspect: FilmState['aspect'];
  durationSec: number;
  thumbUrl: string;
  sceneCount: number;
  hasGenerated: boolean;
  /** made by the crew, so its event log can be replayed */
  crew: boolean;
  /** ISO; empty when the film has no valid createdAt */
  createdAt: string;
}

const time = (iso: string | undefined): number => {
  const t = iso ? Date.parse(iso) : Number.NaN;
  return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
};

/** Ready films with a composition, newest first (a missing or invalid createdAt sorts last; ties keep input order). */
export function toGallerySummaries(films: FilmState[]): GallerySummary[] {
  return films
    .map((f, i) => ({ f, i }))
    .filter(({ f }) => f.status === 'ready' && !!f.composition)
    .sort((a, b) => time(b.f.createdAt) - time(a.f.createdAt) || a.i - b.i)
    .map(({ f }) => {
      const c = f.composition!;
      const product = f.assets.find((a) => a.id === f.brief.productAssetId);
      return {
        id: f.id,
        title: f.title || f.storyboard?.title || 'Untitled film',
        aspect: f.aspect,
        durationSec: Math.round((c.durationInFrames / c.fps) * 10) / 10,
        thumbUrl: product?.url ?? `/api/assets/${f.brief.productAssetId}`,
        sceneCount: f.storyboard?.scenes.length ?? 0,
        crew: !!f.crew,
        hasGenerated: f.storyboard?.scenes.some((s) => s.mode === 'generate') ?? false,
        createdAt: Number.isFinite(time(f.createdAt)) ? f.createdAt : '',
      };
    });
}
