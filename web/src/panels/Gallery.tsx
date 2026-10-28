// Owned by S8a. Finished films as a grid; opening one sets ?film=<id>.
import { useCallback, useEffect, useState } from 'react';
import type { FilmState } from '@shared/composition';
import { api } from '../api/client';
import './gallery/gallery.css';
import { formatDuration, toGalleryItems, type GalleryItem } from './gallery/model';
import type { PanelProps } from './types';

export const STUB_OWNER = 'S8a' as const;

export interface GalleryProps extends Partial<PanelProps> {
  fetchFilms?: () => Promise<FilmState[]>;
  onOpen?: (filmId: string) => void;
}

function defaultOpen(filmId: string) {
  const url = new URL(window.location.href);
  url.searchParams.set('film', filmId);
  window.history.pushState({}, '', url);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

const ratio = (a: GalleryItem['aspect']) => a.replace(':', ' / ');

export default function Gallery({ fetchFilms = api.listFilms, onOpen = defaultOpen }: GalleryProps) {
  const [state, setState] = useState<{ kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; items: GalleryItem[] }>({ kind: 'loading' });

  const load = useCallback(() => {
    setState({ kind: 'loading' });
    fetchFilms().then(
      (films) => setState({ kind: 'ready', items: toGalleryItems(films) }),
      () => setState({ kind: 'error' }),
    );
  }, [fetchFilms]);
  useEffect(load, [load]);

  return (
    <div>
      <h2>Gallery</h2>
      {state.kind === 'loading' && <div className="gallery-grid" aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className="gallery-skeleton" />)}</div>}
      {state.kind === 'error' && (
        <div>
          <p>Could not load films</p>
          <button type="button" onClick={load}>Retry</button>
        </div>
      )}
      {state.kind === 'ready' && state.items.length === 0 && <p>No finished films yet</p>}
      {state.kind === 'ready' && state.items.length > 0 && (
        <div className="gallery-grid">
          {state.items.map((it) => (
            <button key={it.id} type="button" className="gallery-card" aria-label={`${it.title}, ${formatDuration(it.durationSec)}`} onClick={() => onOpen(it.id)}>
              <img src={it.thumbUrl} alt={it.title} style={{ aspectRatio: ratio(it.aspect) }} />
              <span className="meta">
                <span className="title">{it.title}</span>
                <br />
                <span>{formatDuration(it.durationSec)}</span>
                <br />
                <span className="badge">{it.hasGenerated ? 'Includes generated clip' : 'Motion only'}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
