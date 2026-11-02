import { useCallback, useEffect, useRef, useState } from 'react';
import { useFilm } from './api/useFilm';
import { FixturePage } from './dev/FixturePage';
import Chat from './panels/Chat';
import ExportPanel from './panels/ExportPanel';
import Gallery from './panels/Gallery';
import Review from './panels/Review';
import Storyboard from './panels/Storyboard';
import Player, { type PlayerHandle } from './player/Player';
import { CrewStudio } from './crew/CrewStudio';
import { recallIntake } from './crew/intakeHandoff';
import { PendingStudio } from './crew/PendingStudio';
import { ReplayPage } from './crew/replay/ReplayPage';
import { BriefStudio } from './intake/BriefStudio';
import { Filmstrip, sceneStarts } from './shell/Filmstrip';
import { Slot } from './shell/Slot';
import { EmptyPane, railTabs } from './shell/rail';
import { StudioBoard } from './shell/StudioBoard';
import { StudioShell } from './shell/StudioShell';
import { STEPS, stepFor } from './shell/steps';
import { followedFilm, useLineup } from './lineup/api';
import { LineupNote, LineupTabs } from './lineup/LineupTabs';
import { openFilm } from './shell/nav';
import type { Lineup } from '@shared/lineup';
import type { LineupView } from './crew/CrewStudio';

function Director({ filmId, lineup, onLineupStopped }: { filmId: string | null; lineup?: Lineup | null; onLineupStopped?: () => void }) {
  const { film, events } = useFilm(filmId);
  const playerRef = useRef<PlayerHandle>(null);
  const [selected, setSelected] = useState<string>();
  const panelProps = { film, events };
  const getPlayer = useCallback(() => playerRef.current, []);

  const panels = {
    export: <Slot name="export"><ExportPanel {...panelProps} getPlayer={getPlayer} /></Slot>,
    gallery: <Slot name="gallery"><Gallery {...panelProps} /></Slot>,
  };

  // no film yet: the Brief screen, where one chat takes whatever you have
  if (filmId === null) return <BriefStudio />;

  // just sent from the intake chat: keep the same chat on screen while the film loads, instead of flashing the classic desk
  if (filmId && !film && recallIntake(filmId)) return <PendingStudio filmId={filmId} events={events} playerRef={playerRef} panels={panels} />;

  if (film?.crew) {
    const item = lineup?.items.find((i) => i.filmId === film.id);
    const view: LineupView | undefined = lineup
      ? { tabs: <LineupTabs lineup={lineup} filmId={film.id} />, note: <LineupNote lineup={lineup} filmId={film.id} onStopped={onLineupStopped} />, ...(item?.state === 'waiting' ? { hold: 'Waiting for the product before it to finish…' } : {}) }
      : undefined;
    return <CrewStudio film={film} events={events} playerRef={playerRef} panels={panels} lineup={view} />;
  }

  const statusEvent = [...events].reverse().find((e) => e.type === 'film.status');
  const status = statusEvent?.type === 'film.status' ? statusEvent.status : film?.status;
  const boardEvent = [...events].reverse().find((e) => e.type === 'director.storyboard');
  const storyboard = boardEvent?.type === 'director.storyboard' ? boardEvent.storyboard : film?.storyboard;
  const scenes = storyboard?.scenes ?? [];
  const costs = events.reduce((n, e) => (e.type === 'cost' ? n + e.usd : n), 0);

  const shotState = status === 'ready' ? 'done' : status === 'failed' ? 'failed' : status === 'building' ? 'working' : 'waiting';
  const tabs = railTabs(
    {
      board: (
        <StudioBoard
          products={film ? [{ id: film.brief?.productAssetId || 'product', title: film.title || 'Your product' }] : []}
          story={film?.brief?.text || film?.brief?.transcript || ''}
          shots={scenes.map((s) => ({ id: s.id, title: s.text || s.intent, state: shotState }))}
          crew={status && status !== 'ready' && status !== 'failed' ? [`Director ${status}`] : []}
        />
      ),
      plan: <Slot name="storyboard"><Storyboard {...panelProps} /></Slot>,
      crew: <EmptyPane title="One director" text="This film is made by a single director, not the crew. Its notes are in the chat on the right." />,
      review: <Slot name="review"><Review {...panelProps} getPlayer={getPlayer} /></Slot>,
      ...panels,
    },
    { plan: scenes.length || undefined },
  );

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
      defaultTab="plan"
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
  const lineupParam = params.get('lineup');
  const { lineup, reload } = useLineup(lineupParam);
  // the studio follows the crew from one product to the next, unless the owner opened another product's tab
  const followed = followedFilm(lineup);
  const following = useRef<string | undefined>(undefined);
  useEffect(() => {
    const here = new URLSearchParams(window.location.search).get('film');
    if (lineupParam && followed && followed !== following.current && (following.current ? following.current === here : !here)) openFilm(followed, lineupParam);
    following.current = followed;
  }, [followed, lineupParam]);
  if (params.get('fixture') === '1') return <FixturePage />;
  const filmParam = params.get('film');
  if (params.get('replay') === '1' && filmParam) return <ReplayPage key={filmParam} filmId={filmParam} />;
  // keyed, so going home (or opening another film) starts the shell fresh on the right tab
  return <Director key={filmParam ?? 'new'} filmId={filmParam} lineup={lineupParam ? lineup : null} onLineupStopped={reload} />;
}
