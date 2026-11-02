// One rail for every studio screen (the Brief, a single film, a catalogue line-up): the same six panels in the same order,
// so the left side never changes shape. A panel with nothing to show yet says what will land there.
import type { ReactNode } from 'react';
import type { IconName } from './Icon';
import type { ShellTab } from './StudioShell';

export type RailId = 'board' | 'plan' | 'crew' | 'review' | 'export' | 'gallery';

const RAIL: Array<{ id: RailId; label: string; icon: IconName; empty: [string, string] }> = [
  { id: 'board', label: 'Board', icon: 'grid', empty: ['The board', 'What the crew understood: your products, the story, the shots and who is working on them.'] },
  { id: 'plan', label: 'Plan', icon: 'list', empty: ['The plan', 'The showrunner writes the shots here, one card per scene, and you can reorder or cut them.'] },
  { id: 'crew', label: 'Crew', icon: 'users', empty: ['The crew', 'The showrunner, builders and critic light up here while they work, with the takes they made.'] },
  { id: 'review', label: 'Review', icon: 'eye', empty: ['Review', 'The critic checks every shot: what it found, what was fixed, what still needs you.'] },
  { id: 'export', label: 'Export', icon: 'download', empty: ['Export', 'Record the finished film to a video file, in the format you picked.'] },
  { id: 'gallery', label: 'Gallery', icon: 'bolt', empty: ['Gallery', 'Every film you made, to open again.'] },
];

export function EmptyPane({ title, text }: { title: string; text: string }) {
  return (
    <div className="sh-empty-pane">
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}

/** The rail's six tabs in their fixed order; a panel left out shows what will appear in it. */
export function railTabs(content: Partial<Record<RailId, ReactNode>>, badges: Partial<Record<RailId, string | number | undefined>> = {}): ShellTab[] {
  return RAIL.map((r) => ({
    id: r.id,
    label: r.label,
    icon: r.icon,
    badge: badges[r.id],
    content: content[r.id] ?? <EmptyPane title={r.empty[0]} text={r.empty[1]} />,
  }));
}
