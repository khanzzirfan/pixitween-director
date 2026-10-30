// Owned by S12d, laid out by S14. The studio for a crew film, inside the shell: plan and crew on the left, the player and filmstrip in the middle, the conversation on the right.
import { useCallback, useState, type RefObject } from 'react';
import type { FilmState } from '@shared/composition';
import type { FilmEvent } from '@shared/events';
import { api } from '../api/client';
import { captureScene } from '../capture/driver';
import Player, { type PlayerHandle } from '../player/Player';
import { Filmstrip, sceneStarts } from '../shell/Filmstrip';
import { StudioShell, type ShellTab } from '../shell/StudioShell';
import { STEPS, stepFor } from '../shell/steps';
import { BudgetMeter } from './BudgetMeter';
import { ChatThread } from './ChatThread';
import { CrewBoard } from './CrewBoard';
import { LiveStoryboard } from './LiveStoryboard';
import { ringFor } from './SceneCard';
import { TakesPicker } from './TakesPicker';
import { useCaptureRequests } from './useCaptureRequests';
import { useCrew, useNow } from './useCrew';
import './crew.css';

export function CrewStudio({ film, events, playerRef, frozenNow, extraTabs = [] }: { film: FilmState; events: FilmEvent[]; playerRef: RefObject<PlayerHandle | null>; frozenNow?: number; extraTabs?: ShellTab[] }) {
  const { crew, actions } = useCrew(film.id, events);
  const liveNow = useNow(1000, frozenNow !== undefined);
  const now = frozenNow ?? liveNow;
  const getPlayer = useCallback(() => playerRef.current, [playerRef]);
  const storyboard = crew.storyboard ?? film.storyboard;
  const [selected, setSelected] = useState<string>();
  useCaptureRequests({ filmId: film.id, requests: crew.captureRequests, storyboard, getPlayer });

  const product = film.assets.find((a) => a.id === film.brief.productAssetId);
  const status = [...events].reverse().find((e) => e.type === 'film.status');
  const filmStatus = status?.type === 'film.status' ? status.status : film.status;

  const poster = useCallback(async () => {
    const p = playerRef.current;
    if (!p || !storyboard?.scenes[0]) return undefined;
    const c = await captureScene(p, storyboard, storyboard.scenes[0].id, [0.1]);
    const f = c.frames[0];
    return f && !f.blank ? URL.createObjectURL(f.blob) : undefined;
  }, [playerRef, storyboard]);

  const play = () => {
    playerRef.current?.seek(0);
    playerRef.current?.play();
  };

  const scenes = storyboard?.scenes ?? [];
  const jobs = Object.values(crew.jobs);
  const busy = Object.values(crew.lanes).filter((l) => l.state !== 'idle').length;
  const jump = (sceneId: string) => {
    setSelected(sceneId);
    const at = sceneStarts(scenes)[scenes.findIndex((s) => s.id === sceneId)];
    if (at !== undefined) playerRef.current?.seek(at);
  };

  const tabs: ShellTab[] = [
    { id: 'plan', label: 'Plan', icon: 'list', badge: scenes.length || undefined, content: <LiveStoryboard crew={crew} now={now} onOps={(ops) => actions!.postStoryboard(ops)} /> },
    {
      id: 'crew',
      label: 'Crew',
      icon: 'users',
      badge: busy || undefined,
      content: (
        <>
          <CrewBoard crew={crew} now={now} onCancel={(id) => void actions!.cancelJob(id)} />
          <TakesPicker crew={crew} onPick={(jobId, takeFilmId) => actions!.pickTake(jobId, takeFilmId)} />
        </>
      ),
    },
    ...extraTabs,
  ];

  return (
    <StudioShell
      testId="crew-studio"
      title={crew.storyboard?.title ?? film.title ?? 'Your film'}
      status={filmStatus}
      steps={STEPS}
      step={stepFor(filmStatus)}
      tabs={tabs}
      defaultTab="plan"
      stage={
        <section className="slot stage" data-testid="slot-player">
          {/* a finished film is remounted per version: the engine does not rebuild a mounted composition when its source changes, so the picture would stay on the first build */}
          <Player key={filmStatus === 'ready' ? `v${film.version}` : 'live'} ref={playerRef as RefObject<PlayerHandle>} composition={film.composition ?? null} />
        </section>
      }
      strip={<Filmstrip scenes={scenes} selected={selected} onSelect={jump} ringOf={(id) => ringFor(jobs, id)} />}
      side={
        <ChatThread
          crew={crew}
          now={now}
          filmStatus={filmStatus}
          aspect={film.aspect}
          productUrl={product?.url}
          getPoster={poster}
          onPlay={play}
          onSend={(message) => api.chat(film.id, { message })}
          onVoice={(blob) => actions!.postVoice(blob)}
        />
      }
      sideTitle="Talk to the showrunner"
      headerRight={<BudgetMeter budget={crew.budget} credits={crew.credits} />}
    />
  );
}
