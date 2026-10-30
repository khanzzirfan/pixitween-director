import type { FilmState } from '@shared/composition';

export interface GalleryItem {
  id: string;
  title: string;
  aspect: FilmState['aspect'];
  durationSec: number;
  thumbUrl: string;
  sceneCount: number;
  hasGenerated: boolean;
  /** short local date, empty when the film has no valid createdAt */
  createdLabel: string;
}

const time = (iso: string | undefined): number => {
  const t = iso ? Date.parse(iso) : Number.NaN;
  return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
};

/** Ready films with a composition, newest first (a missing or invalid createdAt sorts last; ties keep input order). */
export function toGalleryItems(films: FilmState[]): GalleryItem[] {
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
        hasGenerated: f.storyboard?.scenes.some((s) => s.mode === 'generate') ?? false,
        createdLabel: Number.isFinite(time(f.createdAt)) ? new Date(f.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '',
      };
    });
}

export function formatDuration(sec: number): string {
  const total = Math.round(sec);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
