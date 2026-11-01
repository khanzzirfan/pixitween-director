// Owned by S9. Chat renders it in its header: which model made the last edit, and the Local-mode switch.
import type { FilmEvent } from '@shared/events';
import { formatBadge } from './backend-badge/format';
import { LocalModeToggle } from './backend-badge/LocalModeToggle';

export const STUB_OWNER = 'S9' as const;

export default function BackendBadge({ events = [] }: { events?: FilmEvent[] }) {
  const badge = formatBadge(events);
  return (
    <div className="backend-badge" data-testid="backend-badge">
      {badge && <span className={badge.local ? 'badge-local' : undefined}>{badge.text}</span>}
      <LocalModeToggle />
    </div>
  );
}
