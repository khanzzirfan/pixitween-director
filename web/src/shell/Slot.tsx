// The one slot the studio's panes live in: a named section the tests can find (`slot-player`,
// `slot-catalog`, …). The shell mounts every pane at once and only hides the inactive ones.
import type { ReactNode } from 'react';

export function Slot({ name, children }: { name: string; children: ReactNode }) {
  return (
    <section className="slot" data-testid={`slot-${name}`}>
      {children}
    </section>
  );
}
