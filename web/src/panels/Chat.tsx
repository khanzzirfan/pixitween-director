// Owned by S6. S2 stub: replace the body, keep the export names. Renders <BackendBadge /> in its header (S9 fills it).
import type { AepCompositionJson } from 'reacthub-pixitweenjs';
import type { PlayerHandle } from '../player/Player';
import BackendBadge from './BackendBadge';
import type { PanelProps } from './types';

export const STUB_OWNER = 'S6' as const;

/** `player` and `comp` are optional: without them canvas picking is off while the layer list still works (D-7). */
export interface ChatProps extends PanelProps {
  player?: PlayerHandle | null;
  comp?: AepCompositionJson | null;
}

export default function Chat(_props: ChatProps) {
  return (
    <div>
      <header>
        <h2>Chat</h2>
        <BackendBadge />
      </header>
      <p>Not built yet</p>
    </div>
  );
}
