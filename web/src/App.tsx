import { useRef, type ReactNode } from 'react';
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
        <Slot name="export"><ExportPanel {...panelProps} /></Slot>
        <Slot name="gallery"><Gallery {...panelProps} /></Slot>
      </main>
    </>
  );
}

export function App() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('fixture') === '1') return <FixturePage />;
  return <Director filmId={params.get('film')} />;
}
