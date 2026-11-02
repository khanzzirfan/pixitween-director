import { useCallback, useEffect, useRef, useState } from 'react';
import { useFilm } from './api/useFilm';
import { FixturePage } from './dev/FixturePage';
import BackendBadge from './panels/BackendBadge';
import Chat from './panels/Chat';
import Desk from './panels/Desk';
import ExportPanel from './panels/ExportPanel';
import Gallery from './panels/Gallery';
import NewFilm from './panels/NewFilm';
import Review from './panels/Review';
import Storyboard from './panels/Storyboard';
import Player, { type PlayerHandle } from './player/Player';
import { CrewStudio } from './crew/CrewStudio';
import { recallIntake } from './crew/intakeHandoff';
import { PendingStudio } from './crew/PendingStudio';
import { ReplayPage } from './crew/replay/ReplayPage';
import CatalogImport from './catalog/CatalogImport';
import CatalogPage from './catalog/CatalogPage';
import { Filmstrip, sceneStarts } from './shell/Filmstrip';
import { Slot } from './shell/Slot';
import { StudioShell, type ShellTab } from './shell/StudioShell';
import { STEPS, stepFor } from './shell/steps';

function Director({ filmId }: { filmId: string | null }) {
  const { film, events } = useFilm(filmId);
  const playerRef = useRef<PlayerHandle>(null);
  const [selected, setSelected] = useState<string>();
  const panelProps = { film, events };
  const getPlayer = useCallback(() => playerRef.current, []);

  const exportTab: ShellTab = { id: 'export', label: 'Export', icon: 'download', content: <Slot name="export"><ExportPanel {...panelProps} getPlayer={getPlayer} /></Slot> };
  const galleryTab: ShellTab = { id: 'gallery', label: 'Gallery', icon: 'grid', content: <Slot name="gallery"><Gallery {...panelProps} /></Slot> };

  // just sent from the intake chat: keep the same chat on screen while the film loads, instead of flashing the classic desk
  if (filmId && !film && recallIntake(filmId)) return <PendingStudio filmId={filmId} events={events} playerRef={playerRef} extraTabs={[exportTab, galleryTab]} />;

  if (film?.crew) return <CrewStudio film={film} events={events} playerRef={playerRef} extraTabs={[exportTab, galleryTab]} />;

  const statusEvent = [...events].reverse().find((e) => e.type === 'film.status');
  const status = statusEvent?.type === 'film.status' ? statusEvent.status : film?.status;
  const boardEvent = [...events].reverse().find((e) => e.type === 'director.storyboard');
  const storyboard = boardEvent?.type === 'director.storyboard' ? boardEvent.storyboard : film?.storyboard;
  const scenes = storyboard?.scenes ?? [];
  const costs = events.reduce((n, e) => (e.type === 'cost' ? n + e.usd : n), 0);

  const tabs: ShellTab[] = [
    { id: 'catalog', label: 'Catalog', icon: 'grid', content: <Slot name="catalog"><CatalogImport /></Slot> },
    { id: 'new', label: 'Desk', icon: 'plus', content: <Slot name="new-film"><Desk /></Slot> },
    { id: 'plan', label: 'Plan', icon: 'list', badge: scenes.length || undefined, content: <Slot name="storyboard"><Storyboard {...panelProps} /></Slot> },
    { id: 'review', label: 'Review', icon: 'eye', content: <Slot name="review"><Review {...panelProps} getPlayer={getPlayer} /></Slot> },
    exportTab,
    galleryTab,
  ];

  const jump = (sceneId: string) => {
    setSelected(sceneId);
    const at = sceneStarts(scenes)[scenes.findIndex((s) => s.id === sceneId)];
    if (at !== undefined) playerRef.current?.seek(at);
  };

  return (
    <StudioShell
      title={film?.title ?? storyboard?.title ?? 'New film'}
      status={status}
      steps={STEPS}
      step={film ? stepFor(status) : 0}
      tabs={tabs}
      defaultTab={film ? 'plan' : 'catalog'}
      stage={<Slot name="player"><Player ref={playerRef} composition={film?.composition ?? null} /></Slot>}
      strip={<Filmstrip scenes={scenes} selected={selected} onSelect={jump} />}
      side={filmId === null
        ? <Slot name="chat"><BackendBadge events={events} /><NewFilm {...panelProps} /></Slot>
        : <Slot name="chat"><Chat {...panelProps} player={playerRef.current} comp={film?.composition} /></Slot>}
      sideTitle={filmId === null ? 'Make a new film' : "Director's desk"}
      onTogglePlay={() => document.querySelector<HTMLButtonElement>('[data-testid="slot-player"] .player-controls button')?.click()}
      headerRight={film && costs > 0 ? <span className="sh-cost" title="Spent on this film">${costs.toFixed(2)}</span> : undefined}
    />
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
  // a catalog run brings its own carrier film, so it is its own page, not a film of the studio's
  const catalogParam = params.get('catalog');
  if (catalogParam) return <CatalogPage key={catalogParam} catalogId={catalogParam} />;
  const filmParam = params.get('film');
  if (params.get('replay') === '1' && filmParam) return <ReplayPage key={filmParam} filmId={filmParam} />;
  // keyed, so going home (or opening another film) starts the shell fresh on the right tab
  return <Director key={filmParam ?? 'new'} filmId={filmParam} />;
}
