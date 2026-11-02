// The studio between "Send" and the film arriving: the same frame and the same chat as CrewStudio, with the user's brief already in the thread.
import { type RefObject } from 'react';
import Player, { type PlayerHandle } from '../player/Player';
import type { FilmEvent } from '@shared/events';
import { Slot } from '../shell/Slot';
import { StudioShell, type ShellTab } from '../shell/StudioShell';
import { STEPS } from '../shell/steps';
import { ChatThread } from './ChatThread';
import { CrewBoard } from './CrewBoard';
import { LiveStoryboard } from './LiveStoryboard';
import { recallIntake } from './intakeHandoff';
import { useCrew, useNow } from './useCrew';
import './crew.css';

export function PendingStudio({ filmId, events, playerRef, extraTabs = [] }: { filmId: string; events: FilmEvent[]; playerRef: RefObject<PlayerHandle | null>; extraTabs?: ShellTab[] }) {
  const { crew } = useCrew(filmId, events);
  const now = useNow();
  const tabs: ShellTab[] = [
    { id: 'plan', label: 'Plan', icon: 'list', content: <LiveStoryboard crew={crew} now={now} /> },
    { id: 'crew', label: 'Crew', icon: 'users', content: <CrewBoard crew={crew} now={now} /> },
    ...extraTabs,
  ];
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
