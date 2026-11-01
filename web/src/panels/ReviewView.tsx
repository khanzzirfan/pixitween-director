import { useMemo } from 'react';
import type { FilmState } from '@shared/composition';
import type { FilmEvent } from '@shared/events';
import type { Geometry, ReviewState } from '../review/useAutoReview';

/** Geometry errors above this share of the frame are shown; the model is trusted below it. */
export const GEOMETRY_BADGE_THRESHOLD = 0.03;

export interface ReviewViewProps {
  film: FilmState | null;
  events: FilmEvent[];
  state: ReviewState;
  geometry: Geometry | null;
  error?: string;
  rerun(): void;
}

type Finding = Extract<FilmEvent, { type: 'review.finding' }>;
type Fix = Extract<FilmEvent, { type: 'review.fix' }>;

const assetUrl = (id: string) => `/api/assets/${id}`;

/** One row per before frame: a later event with the after frame completes an earlier one. */
function mergeFixes(fixes: Fix[]): { paired: Fix[]; notes: Fix[] } {
  const byBefore = new Map<string, Fix>();
  const notes: Fix[] = [];
  for (const f of fixes) {
    if (!f.beforeFrame) {
      notes.push(f);
      continue;
    }
    byBefore.set(f.beforeFrame, { ...byBefore.get(f.beforeFrame), ...f });
  }
  return { paired: [...byBefore.values()], notes };
}

export function ReviewView({ film, events, state, geometry, error, rerun }: ReviewViewProps) {
  const { findings, fixes, reviewing, sawReview } = useMemo(() => {
    const findings = events.filter((e): e is Finding => e.type === 'review.finding');
    const fixes = events.filter((e): e is Fix => e.type === 'review.fix');
    const statuses = events.filter((e): e is Extract<FilmEvent, { type: 'film.status' }> => e.type === 'film.status');
    const last = statuses.at(-1)?.status;
    return { findings, fixes, reviewing: last === 'reviewing', sawReview: statuses.some((s) => s.status === 'reviewing') };
  }, [events]);

  const sceneIds = useMemo(() => {
    const ids = new Set<string>((film?.storyboard?.scenes ?? []).map((s) => s.id));
    for (const e of [...findings, ...fixes]) ids.add(e.sceneId);
    return [...ids];
  }, [film, findings, fixes]);

  const { paired, notes } = mergeFixes(fixes);
  const busy = state === 'running' || reviewing;

  return (
    <div>
      <div className="panel-heading">
        <div>
          <span className="eyebrow">QUALITY CHECK</span>
          <h2>Review</h2>
        </div>
        <button type="button" onClick={rerun} disabled={busy}>
          Re-run review
        </button>
      </div>
      {reviewing && (
        <p data-testid="review-spinner" role="status">
          Checking the film…
        </p>
      )}
      {geometry && geometry.maxRelError > GEOMETRY_BADGE_THRESHOLD && (
        <p data-testid="geometry-badge" className="review-badge">
          Geometry model error {Math.round(geometry.maxRelError * 100)}%
        </p>
      )}
      {state === 'error' && <p role="alert">{error ?? 'The review failed.'}</p>}
      {sawReview && !reviewing && findings.length === 0 && <p>No issues found</p>}
      {sceneIds.map((sceneId) => {
        const sceneFindings = findings.filter((f) => f.sceneId === sceneId);
        const sceneFixes = paired.filter((f) => f.sceneId === sceneId);
        const sceneNotes = notes.filter((f) => f.sceneId === sceneId);
        return (
          <section key={sceneId} data-testid={`review-scene-${sceneId}`} className="review-scene">
            <h3>{sceneId}</h3>
            <ul>
              {sceneFindings.map((f, i) => (
                <li key={`f-${i}`} data-testid="finding">
                  <span className="review-badge">{f.deterministic ? 'Rule' : 'Spark'}</span> <strong>{f.kind}</strong>
                  {f.atSec !== undefined && <span> at {f.atSec.toFixed(2)} s</span>}
                  <p>{f.evidence}</p>
                </li>
              ))}
              {sceneFixes.map((f) => (
                <li key={`x-${f.beforeFrame}`} data-testid="fix">
                  <div className="review-pair">
                    <img src={assetUrl(f.beforeFrame!)} alt="before fix" />
                    {f.afterFrame && <img src={assetUrl(f.afterFrame)} alt="after fix" />}
                  </div>
                  <p>{f.note}</p>
                </li>
              ))}
              {sceneNotes.map((f, i) => (
                <li key={`n-${i}`} data-testid="fix-note">
                  {f.note}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
