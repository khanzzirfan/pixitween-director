// Owned by S12e. "Watch it being made": a finished crew film replayed from its event log. It reads the film, its versions and its log, and nothing else: no event stream, no chat, no model call.
import { useEffect, useRef, useState } from 'react';
import type { FilmState, FilmVersion } from '@shared/composition';
import { api } from '../../api/client';
import type { PlayerHandle } from '../../player/Player';
import { CrewStudio } from '../CrewStudio';
import { ReplayBar } from './ReplayBar';
import { useEventLog } from './useEventLog';
import { useReplay } from './useReplay';
import '../crew.css';

export function ReplayPage({ filmId, speed = 4 }: { filmId: string; speed?: 1 | 2 | 4 | 8 }) {
  const [film, setFilm] = useState<FilmState | null>(null);
  const [versions, setVersions] = useState<FilmVersion[]>([]);
  const [failed, setFailed] = useState(false);
  const log = useEventLog(filmId);
  const playerRef = useRef<PlayerHandle>(null);

  useEffect(() => {
    let live = true;
    Promise.all([api.getFilm(filmId), api.getVersions(filmId)]).then(
      ([f, v]) => live && (setFilm(f), setVersions(v)),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [filmId]);

  const replay = useReplay(log.events, versions, { autoplay: true, speed });
  if (failed || log.error) return <p role="alert" className="replay-missing">That film has no replay{log.error === 'not_found' ? ': it was not found' : ''}.</p>;
  if (!film || log.loading) return <p className="replay-missing" aria-busy="true">Loading the replay…</p>;

  // before the first version exists the picture is empty; the film's own storyboard is the fallback for the plan
  const shownFilm: FilmState = { ...film, composition: replay.composition, version: replay.version ?? 0, status: 'planning', storyboard: undefined };
  return (
    <CrewStudio
      film={shownFilm}
      events={replay.shown}
      playerRef={playerRef}
      frozenNow={replay.nowMs ?? 0}
      replay={{ bar: <ReplayBar replay={replay} />, version: replay.version }}
    />
  );
}
