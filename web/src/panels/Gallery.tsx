// Owned by S8a. Finished films as a grid; opening one sets ?film=<id>.
import { goHome } from '../shell/nav';
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
  onReplay?: (filmId: string) => void;
}

function defaultOpen(filmId: string, replay = false) {
  const url = new URL(window.location.href);
  url.searchParams.set('film', filmId);
  if (replay) url.searchParams.set('replay', '1');
  else url.searchParams.delete('replay');
  window.history.pushState({}, '', url);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

const ratio = (a: GalleryItem['aspect']) => a.replace(':', ' / ');

export default function Gallery({ fetchFilms = api.listFilms, onOpen = defaultOpen, onReplay = (id) => defaultOpen(id, true) }: GalleryProps) {
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
      <button type="button" className="gallery-new" onClick={goHome}>+ New film</button>
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
            <div key={it.id} className="gallery-item">
            <button type="button" className="gallery-card" aria-label={`${it.title}, ${formatDuration(it.durationSec)}`} onClick={() => onOpen(it.id)}>
              <img src={it.thumbUrl} alt={it.title} style={{ aspectRatio: ratio(it.aspect) }} />
              <span className="meta">
                <span className="title">{it.title}</span>
                <br />
                <span>{formatDuration(it.durationSec)}{it.createdLabel ? ` · ${it.createdLabel}` : ''}</span>
                <br />
                <span className="badge">{it.hasGenerated ? 'Includes generated clip' : 'Motion only'}</span>
              </span>
            </button>
            {it.crew && <button type="button" className="gallery-replay" onClick={() => onReplay(it.id)}>Watch it being made</button>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
