// Owned by S7a. Per-scene mode, cost review and approval for real-video clips.
import type { AepCompositionJson } from 'reacthub-pixitweenjs';
import type { FilmEvent } from '@shared/events';
import type { FilmState } from '@shared/composition';
import { useEffect, useState } from 'react';
import { getCrewConfig } from '../crew/api';
import ModeToggle from './ModeToggle';
import { defaultGenerateApi, useGenerate, type GenerateApi, type SceneView } from './useGenerate';

export const STUB_OWNER = 'S7a' as const;
export const MAX_GENERATE_SCENES = 2;

export interface GenerateApprovalProps {
  film?: FilmState | null;
  filmId?: string;
  comp?: AepCompositionJson | null;
  events: FilmEvent[];
  api?: GenerateApi;
  /** Offer 3D as a mode; read from the server when not given. */
  product3d?: boolean;
}

const ERROR_TEXT: Record<string, (e: NonNullable<SceneView['error']>) => string> = {
  public_url_invalid: (e) => e.message ?? 'PUBLIC_BASE_URL must be a public https URL.',
  insufficient_credits: () => 'Not enough Clippy credits',
  rate_limited: (e) => `Generation limit reached, try again in ${Math.max(1, Math.ceil((e.retryAfterSec ?? 60) / 60))} minutes`,
  generate_cap: () => `A film can have at most ${MAX_GENERATE_SCENES} generated scenes`,
  token_expired: () => 'The proposal expired, review again',
  token_used: () => 'This proposal was already used',
  pro_plan_required: () => 'Clippy needs a Pro plan for real video',
};

const errorText = (e?: SceneView['error']) => (e ? (ERROR_TEXT[e.code]?.(e) ?? e.message ?? 'Something went wrong') : undefined);

function SceneCard({
  s,
  api,
  generateCount,
  actions,
  product3d,
}: {
  s: SceneView;
  api: GenerateApi;
  generateCount: number;
  actions: ReturnType<typeof useGenerate>;
  product3d: boolean;
}) {
  void api;
  const expired = !!s.proposal && Date.parse(s.proposal.expiresAt) < Date.now();
  const urlBad = s.error?.code === 'public_url_invalid';
  const err = expired && !s.error ? 'The proposal expired, review again' : errorText(s.error);
  const capReached = s.mode === 'motion' && generateCount >= MAX_GENERATE_SCENES;

  return (
    <div className="scene-card story-scene" data-testid={`gen-${s.id}`}>
      <h3 className="scene-number">{s.id}</h3>
      <ModeToggle
        sceneId={s.id}
        mode={s.mode === 'generate' && s.phase !== 'motion' ? 'generate' : product3d && s.three ? '3d' : 'motion'}
        product3d={product3d}
        busy={s.busy}
        disabledReason={capReached ? `A film can have at most ${MAX_GENERATE_SCENES} generated scenes` : undefined}
        onChange={(m) => (m === 'generate' ? void actions.review(s.id) : m === '3d' ? void actions.choose3D(s.id) : void actions.keepMotion(s.id))}
      />

      {s.phase === 'idle' && (
        <button type="button" onClick={() => void actions.review(s.id)} disabled={s.busy}>
          Review and approve
        </button>
      )}

      {s.phase === 'proposed' && (
        <div>
          <p>Generate this clip: about 25 credits, usually a few minutes. The scene image and prompt are sent to Clippy.</p>
          {(s.reason ?? s.proposal?.reason) && <p>{s.reason ?? s.proposal?.reason}</p>}
          <p>{s.proposal?.balance !== undefined ? `Balance: ${s.proposal.balance} credits` : 'Balance unavailable'}</p>
          <button type="button" disabled={s.busy || expired || urlBad} onClick={() => void actions.approve(s.id)}>
            Approve
          </button>{' '}
          <button type="button" disabled={s.busy} onClick={() => void actions.keepMotion(s.id)}>
            Keep as motion
          </button>
        </div>
      )}

      {s.phase === 'running' && <p>Rendering... {s.status}</p>}
      {s.phase === 'placing' && <p>Placing the clip in the scene...</p>}
      {s.phase === 'checking' && <p>Checking the product is visible...</p>}
      {s.phase === 'done' && (
        <p>Clip placed{s.visibleFrac !== undefined ? <> · Product visible in {Math.round(s.visibleFrac * 100)}% of frames</> : null}</p>
      )}
      {s.phase === 'failed' && (
        <div>
          <p>{s.message}</p>
          <button type="button" onClick={() => void actions.keepMotion(s.id)}>
            Keep as motion
          </button>{' '}
          <button type="button" onClick={() => void actions.review(s.id)}>
            Try again
          </button>
        </div>
      )}
      {s.phase === 'needs_retry' && (
        <div>
          <p>{s.message}</p>
          <button type="button" onClick={() => void actions.review(s.id)}>
            Retry (25 credits)
          </button>
        </div>
      )}
      {err && <p role="alert">{err}</p>}
    </div>
  );
}

/** Whether 3D is on: the prop when given, otherwise what the server says (asked once). */
function useProduct3D(given: boolean | undefined): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (given !== undefined || typeof fetch !== 'function') return;
    let live = true;
    getCrewConfig().then((c) => live && setOn(c.product3d === true), () => undefined);
    return () => {
      live = false;
    };
  }, [given]);
  return given ?? on;
}

export default function GenerateApproval({ film, filmId, comp, events, api = defaultGenerateApi, product3d }: GenerateApprovalProps) {
  const three = useProduct3D(product3d);
  const id = filmId ?? film?.id;
  const composition = comp ?? film?.composition ?? null;
  const actions = useGenerate({ filmId: id, comp: composition, events, api });
  if (!id)
    return (
      <div>
        <div className="panel-heading">
          <div>
            <span className="eyebrow">MOTION OR REAL VIDEO</span>
            <h2>Generate</h2>
          </div>
        </div>
        <p>Open a film to choose real video for a scene.</p>
      </div>
    );
  const generateCount = actions.scenes.filter((s) => s.mode === 'generate').length;
  return (
    <div>
      <div className="panel-heading">
        <div>
          <span className="eyebrow">{three ? 'MOTION, 3D OR REAL VIDEO' : 'MOTION OR REAL VIDEO'}</span>
          <h2>Generate</h2>
        </div>
        <span className="step-pill">UP TO 2 SCENES</span>
      </div>
      {actions.scenes.length === 0 ? <p>No scenes yet.</p> : <p className="gen-note">Real video costs about 25 credits a scene and needs your approval. Up to {MAX_GENERATE_SCENES} scenes.</p>}
      {actions.scenes.map((s) => (
        <SceneCard key={s.id} s={s} api={api} generateCount={generateCount} actions={actions} product3d={three} />
      ))}
    </div>
  );
}
