// The studio between "Send" and the film arriving: the same frame and the same chat as CrewStudio, with the user's brief already in the thread.
import { type ReactNode, type RefObject } from 'react';
import Player, { type PlayerHandle } from '../player/Player';
import type { FilmEvent } from '@shared/events';
import { Slot } from '../shell/Slot';
import { railTabs, type RailId } from '../shell/rail';
import { StudioBoard } from '../shell/StudioBoard';
import { StudioShell } from '../shell/StudioShell';
import { STEPS } from '../shell/steps';
import { ChatThread } from './ChatThread';
import { CrewBoard } from './CrewBoard';
import { LiveStoryboard } from './LiveStoryboard';
import { filmBoard } from './filmBoard';
import { recallIntake } from './intakeHandoff';
import { useCrew, useNow } from './useCrew';
import './crew.css';

export function PendingStudio({ filmId, events, playerRef, panels = {} }: { filmId: string; events: FilmEvent[]; playerRef: RefObject<PlayerHandle | null>; panels?: Partial<Record<RailId, ReactNode>> }) {
  const { crew } = useCrew(filmId, events);
  const now = useNow();
  const tabs = railTabs({
    board: <StudioBoard {...filmBoard(null, crew, recallIntake(filmId)?.text ?? '')} />,
    plan: <LiveStoryboard crew={crew} now={now} />,
    crew: <CrewBoard crew={crew} now={now} />,
    ...panels,
  });
  return (
    <StudioShell
      testId="pending-studio"
      title="Your film"
      status="planning"
      steps={STEPS}
      step={1}
      tabs={tabs}
      defaultTab="plan"
      stage={<Slot name="player"><Player ref={playerRef as RefObject<PlayerHandle>} composition={null} /></Slot>}
      side={<ChatThread crew={crew} now={now} aspect="16:9" onPlay={() => {}} onSend={() => {}} onVoice={() => {}} brief={recallIntake(filmId)} waiting="starting your film…" composerDisabled />}
      sideTitle="Talk to the showrunner"
    />
  );
}
