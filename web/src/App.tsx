import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useFilm } from './api/useFilm';
import { FixturePage } from './dev/FixturePage';
import Chat from './panels/Chat';
import ExportPanel from './panels/ExportPanel';
import Gallery from './panels/Gallery';
import GenerateApproval from './panels/GenerateApproval';
import NewFilm from './panels/NewFilm';
import Review from './panels/Review';
import Storyboard from './panels/Storyboard';
import Player, { type PlayerHandle } from './player/Player';

function Slot({ name, children }: { name: string; children: ReactNode }) {
  return (
    <section className="slot" data-testid={`slot-${name}`}>
      {children}
    </section>
  );
}

function Director({ filmId }: { filmId: string | null }) {
  const { film, events } = useFilm(filmId);
  const playerRef = useRef<PlayerHandle>(null);
  const panelProps = { film, events };
  return (
    <>
      <header className="app-header">
        <h1>PixiTween Director</h1>
        {film && <span data-testid="film-status">{film.status}</span>}
      </header>
      <main className="grid">
        <Slot name="new-film"><NewFilm {...panelProps} /></Slot>
        <Slot name="storyboard"><Storyboard {...panelProps} /></Slot>
        <Slot name="player"><Player ref={playerRef} composition={film?.composition ?? null} /></Slot>
        <Slot name="review"><Review {...panelProps} /></Slot>
        <Slot name="chat"><Chat {...panelProps} player={playerRef.current} comp={film?.composition} /></Slot>
        <Slot name="generate"><GenerateApproval {...panelProps} /></Slot>
        <Slot name="export"><ExportPanel {...panelProps} getPlayer={() => playerRef.current} /></Slot>
        <Slot name="gallery"><Gallery {...panelProps} /></Slot>
      </main>
    </>
  );
}

export function App() {
  // follow history changes, so the Gallery (which pushes ?film=<id>) can open a film without a reload
  const [search, setSearch] = useState(window.location.search);
  useEffect(() => {
    const onPop = () => setSearch(window.location.search);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const params = new URLSearchParams(search);
  if (params.get('fixture') === '1') return <FixturePage />;
  return <Director filmId={params.get('film')} />;
}
