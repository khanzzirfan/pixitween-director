// Owned by S5b. The Review panel: starts the automatic review and shows what it found and fixed.
import { api } from '../api/client';
import { useEffect, useMemo } from 'react';
import { captureReview, waitForPlayer } from '../capture/driver';
import { installCaptureHook } from '../capture/devHook';
import type { PlayerHandle } from '../player/Player';
import { useAutoReview, type ReviewDeps } from '../review/useAutoReview';
import { ReviewView } from './ReviewView';
import type { PanelProps } from './types';

export const STUB_OWNER = 'S5b' as const;

export default function Review({ film, events, getPlayer }: PanelProps & { getPlayer?: () => PlayerHandle | null }) {
  const storyboard = film?.storyboard;
  const deps = useMemo<ReviewDeps>(
    () => ({
      capture: async () => {
        if (!storyboard) throw new Error('The film has no storyboard yet.');
        return captureReview(await waitForPlayer(() => getPlayer?.() ?? null), storyboard);
      },
      postFrames: (id, form) => api.postFrames(id, form),
    }),
    [getPlayer, storyboard],
  );
  useEffect(
    () =>
      installCaptureHook(
        () => getPlayer?.() ?? null,
        () => storyboard,
      ),
    [getPlayer, storyboard],
  );
  const review = useAutoReview({ filmId: film?.id, events, deps, crew: film?.crew });
  return (
    <ReviewView film={film} events={events} state={review.state} geometry={review.geometry} error={review.error} rerun={review.rerun} />
  );
}
