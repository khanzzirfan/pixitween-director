import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
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
import { CrewStudio } from './crew/CrewStudio';
import { ReplayPage } from './crew/replay/ReplayPage';
import { Filmstrip, sceneStarts } from './shell/Filmstrip';
import { StudioShell, type ShellTab } from './shell/StudioShell';
import { STEPS, stepFor } from './shell/steps';

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
  const [selected, setSelected] = useState<string>();
  const panelProps = { film, events };
  const getPlayer = useCallback(() => playerRef.current, []);

  const exportTab: ShellTab = { id: 'export', label: 'Export', icon: 'download', content: <Slot name="export"><ExportPanel {...panelProps} getPlayer={getPlayer} /></Slot> };
  const galleryTab: ShellTab = { id: 'gallery', label: 'Gallery', icon: 'grid', content: <Slot name="gallery"><Gallery {...panelProps} /></Slot> };

  if (film?.crew) return <CrewStudio film={film} events={events} playerRef={playerRef} extraTabs={[exportTab, galleryTab]} />;

  const statusEvent = [...events].reverse().find((e) => e.type === 'film.status');
  const status = statusEvent?.type === 'film.status' ? statusEvent.status : film?.status;
  const boardEvent = [...events].reverse().find((e) => e.type === 'director.storyboard');
  const storyboard = boardEvent?.type === 'director.storyboard' ? boardEvent.storyboard : film?.storyboard;
  const scenes = storyboard?.scenes ?? [];
  const costs = events.reduce((n, e) => (e.type === 'cost' ? n + e.usd : n), 0);

  const tabs: ShellTab[] = [
    { id: 'new', label: 'New', icon: 'plus', content: <Slot name="new-film"><NewFilm {...panelProps} /></Slot> },
    { id: 'plan', label: 'Plan', icon: 'list', badge: scenes.length || undefined, content: <Slot name="storyboard"><Storyboard {...panelProps} /></Slot> },
    { id: 'review', label: 'Review', icon: 'eye', content: <Slot name="review"><Review {...panelProps} getPlayer={getPlayer} /></Slot> },
    { id: 'generate', label: 'Generate', icon: 'bolt', content: <Slot name="generate"><GenerateApproval {...panelProps} /></Slot> },
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
      defaultTab={film ? 'plan' : 'new'}
      stage={<Slot name="player"><Player ref={playerRef} composition={film?.composition ?? null} /></Slot>}
      strip={<Filmstrip scenes={scenes} selected={selected} onSelect={jump} />}
      side={<Slot name="chat"><Chat {...panelProps} player={playerRef.current} comp={film?.composition} /></Slot>}
      sideTitle="Director's desk"
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
  const filmParam = params.get('film');
  if (params.get('replay') === '1' && filmParam) return <ReplayPage key={filmParam} filmId={filmParam} />;
  return <Director filmId={params.get('film')} />;
}
