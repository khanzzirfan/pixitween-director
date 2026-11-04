// Dev-only: mounts the Review view with built-in events so the panel can be checked without a film.
import { createRoot } from 'react-dom/client';
import { ReviewView } from './ReviewView';
import { reviewFixtureEvents } from './review-fixture';

export function mountReviewFixture(o: { status?: 'reviewing' | 'ready'; geometryError?: number } = {}): void {
  const host = document.createElement('div');
  host.id = 'review-fixture';
  document.body.appendChild(host);
  createRoot(host).render(
    <ReviewView
      film={null}
      events={reviewFixtureEvents(o)}
      state="idle"
      geometry={o.geometryError !== undefined ? { maxRelError: o.geometryError, layers: 1 } : null}
      rerun={() => undefined}
    />,
  );
}
