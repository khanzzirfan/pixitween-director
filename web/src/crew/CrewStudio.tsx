// Owned by S12d. The studio for a crew film: the plan on the left, the player in the middle, the crew and the conversation on the right.
import { useCallback, type RefObject } from 'react';
import type { FilmState } from '@shared/composition';
import type { FilmEvent } from '@shared/events';
import { api } from '../api/client';
import { captureScene } from '../capture/driver';
import Player, { type PlayerHandle } from '../player/Player';
import { BudgetMeter } from './BudgetMeter';
import { ChatThread } from './ChatThread';
import { CrewBoard } from './CrewBoard';
import { LiveStoryboard } from './LiveStoryboard';
import { PhoneView } from './PhoneFrame';
import { TakesPicker } from './TakesPicker';
import { useCaptureRequests } from './useCaptureRequests';
import { useCrew, useNow } from './useCrew';
import './crew.css';

export function CrewStudio({ film, events, playerRef, frozenNow }: { film: FilmState; events: FilmEvent[]; playerRef: RefObject<PlayerHandle | null>; frozenNow?: number }) {
  const { crew, actions } = useCrew(film.id, events);
  const liveNow = useNow(1000, frozenNow !== undefined);
  const now = frozenNow ?? liveNow;
  const getPlayer = useCallback(() => playerRef.current, [playerRef]);
  const storyboard = crew.storyboard ?? film.storyboard;
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
    document.querySelector('[data-testid="slot-player"]')?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    playerRef.current?.seek(0);
    playerRef.current?.play();
  };

  return (
    <div className="studio" data-testid="crew-studio">
      <div className="studio-bar">
        <h2 className="studio-title">{crew.storyboard?.title ?? film.title ?? 'Your film'}</h2>
        <span className={`status-chip st-${filmStatus}`} data-testid="film-status-chip">{filmStatus}</span>
        <div className="studio-spacer" />
        <BudgetMeter budget={crew.budget} credits={crew.credits} />
      </div>
      <div className="studio-grid">
        <div className="col col-plan">
          <LiveStoryboard crew={crew} now={now} onOps={(ops) => actions!.postStoryboard(ops)} />
        </div>
        <div className="col col-stage">
          <section className="slot stage" data-testid="slot-player">
            {/* a finished film is remounted per version: the engine does not rebuild a mounted composition when its source changes, so the picture would stay on the first build */}
            <Player key={filmStatus === 'ready' ? `v${film.version}` : 'live'} ref={playerRef as RefObject<PlayerHandle>} composition={film.composition ?? null} />
          </section>
          <TakesPicker crew={crew} onPick={(jobId, takeFilmId) => actions!.pickTake(jobId, takeFilmId)} />
        </div>
        <div className="col col-crew">
          <CrewBoard crew={crew} now={now} onCancel={(id) => void actions!.cancelJob(id)} />
          <section className="desk" aria-label="Director's desk">
            <header className="crew-head"><div><span className="eyebrow">DIRECTOR'S DESK</span><h2>Talk to the showrunner</h2></div></header>
            <PhoneView>
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
            </PhoneView>
          </section>
        </div>
      </div>
    </div>
  );
}
