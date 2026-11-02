import type { GallerySummary } from '@shared/gallery';

export interface GalleryItem extends Omit<GallerySummary, 'createdAt'> {
  /** short local date, empty when the film has no valid createdAt */
  createdLabel: string;
}

/** The server's summaries, in its order (newest first), with the date shown on the card. */
export function toGalleryItems(summaries: GallerySummary[]): GalleryItem[] {
  return summaries.map(({ createdAt, ...rest }) => ({
    ...rest,
    createdLabel: createdAt ? new Date(createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '',
  }));
}

export function formatDuration(sec: number): string {
  const total = Math.round(sec);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
