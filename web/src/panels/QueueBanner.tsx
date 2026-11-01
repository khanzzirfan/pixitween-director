// Owned by S8b. Shown to a film that is waiting for the crew: its place in line and a rough wait.
import { useEffect, useState } from 'react';
import type { FilmState } from '@shared/composition';

type QueueState = { state: 'queued'; position: number; etaSec: number } | { state: 'running' } | { state: 'unknown' };

export function QueueBanner({ filmId, status, pollMs = 5000, fetchImpl }: { filmId: string; status: FilmState['status']; pollMs?: number; fetchImpl?: typeof fetch }) {
  const [queue, setQueue] = useState<QueueState | null>(null);

  useEffect(() => {
    if (status !== 'new') {
      setQueue(null);
      return;
    }
    let live = true;
    const load = () => {
      const get = fetchImpl ?? fetch;
      get(`/api/queue/${filmId}`)
        .then((r) => (r.ok ? (r.json() as Promise<QueueState>) : null))
        .then((q) => live && setQueue(q), () => live && setQueue(null));
    };
    load();
    const id = setInterval(load, pollMs);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [filmId, status, pollMs, fetchImpl]);

  if (status !== 'new' || !queue || queue.state === 'unknown') return null;
  return (
    <p role="status" aria-live="polite" className="queue-banner">
      {queue.state === 'queued' ? `Waiting for the crew: #${queue.position} in line, about ${Math.max(1, Math.ceil(queue.etaSec / 60))} min (estimate)` : 'Starting the crew…'}
    </p>
  );
}
