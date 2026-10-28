import { useCallback, useMemo, useState } from 'react';
import type { AepCompositionJson } from 'reacthub-pixitweenjs';
import type { AssetRef } from '@shared/composition';
import type { FilmEvent } from '@shared/events';
import { PASSCODE_HEADER } from '@shared/api';
import type { ModeResponse, Proposal } from './generate-types';

export type Phase = 'motion' | 'idle' | 'proposed' | 'running' | 'placing' | 'checking' | 'done' | 'failed' | 'needs_retry';

export interface SceneGen {
  phase: Phase;
  token?: string;
  reason?: string;
  estCredits?: number;
  status?: string;
  message?: string;
  asset?: AssetRef;
  visibleFrac?: number;
}
export type GenState = Record<string, SceneGen>;

const RUNNING = new Set(['approved', 'submitted', 'queued', 'planning', 'rendering', 'downloading']);

export function reduceGenerate(state: GenState, e: FilmEvent): GenState {
  const set = (sceneId: string, next: SceneGen): GenState => ({ ...state, [sceneId]: next });
  switch (e.type) {
    case 'generate.proposed':
      return set(e.sceneId, { phase: 'proposed', token: e.token, reason: e.reason, estCredits: e.estCredits });
    case 'generate.progress': {
      const prev = state[e.sceneId] ?? { phase: 'idle' as Phase };
      if (RUNNING.has(e.status)) return set(e.sceneId, { ...prev, phase: 'running', status: e.status });
      if (e.status === 'placing') return set(e.sceneId, { ...prev, phase: 'placing', status: e.status });
      if (e.status === 'checking') return set(e.sceneId, { ...prev, phase: 'checking', status: e.status });
      if (e.status === 'timed_out') return set(e.sceneId, { ...prev, phase: 'failed', message: 'timed out' });
      if (e.status.startsWith('failed')) return set(e.sceneId, { ...prev, phase: 'failed', message: e.status.replace(/^failed:?\s*/, '') });
      if (e.status === 'cancelled') return set(e.sceneId, { phase: 'motion' });
      return state;
    }
    case 'generate.done':
      return set(e.sceneId, { ...(state[e.sceneId] ?? {}), phase: 'done', asset: e.asset, visibleFrac: e.productVisibleFrac });
    case 'review.finding':
      return e.kind === 'product-missing-in-clip' ? set(e.sceneId, { ...(state[e.sceneId] ?? {}), phase: 'needs_retry', message: e.evidence }) : state;
    default:
      return state;
  }
}

export interface GenerateApi {
  setMode(filmId: string, sceneId: string, mode: 'motion' | 'generate'): Promise<ModeResponse>;
  approve(filmId: string, sceneId: string, token: string): Promise<unknown>;
}

export class GenerateApiError extends Error {
  constructor(public status: number, public body: { error?: string; message?: string; retryAfterSec?: number }) {
    super(body.error ?? `request failed with ${status}`);
  }
}

function passcode(): string | null {
  try {
    return localStorage.getItem('director.passcode');
  } catch {
    return null;
  }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const pass = passcode();
  if (pass) headers[PASSCODE_HEADER] = pass;
  const res = await fetch(path, { method: 'POST', headers, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new GenerateApiError(res.status, json as never);
  return json;
}

export const defaultGenerateApi: GenerateApi = {
  setMode: (filmId, sceneId, mode) => post(`/api/films/${filmId}/scenes/${sceneId}/mode`, { mode }),
  approve: (filmId, sceneId, token) => post(`/api/films/${filmId}/scenes/${sceneId}/approve`, { token }),
};

export interface SceneView extends SceneGen {
  id: string;
  mode: 'motion' | 'generate';
  proposal?: Proposal;
  error?: { code: string; message?: string; retryAfterSec?: number };
  busy: boolean;
}

interface Local {
  proposal?: Proposal;
  error?: SceneView['error'];
  reverted?: boolean;
  busy?: boolean;
}

export function useGenerate(o: { filmId: string | null | undefined; comp: AepCompositionJson | null | undefined; events: FilmEvent[]; api: GenerateApi }) {
  const { filmId, comp, events, api } = o;
  const [local, setLocal] = useState<Record<string, Local>>({});
  const patch = useCallback((sceneId: string, p: Local) => setLocal((s) => ({ ...s, [sceneId]: { ...s[sceneId], ...p } })), []);

  const fromEvents = useMemo(() => events.reduce(reduceGenerate, {} as GenState), [events]);

  const scenes: SceneView[] = useMemo(() => {
    const meta = (comp?.meta as { director?: { scenes?: Record<string, { mode: 'motion' | 'generate' }> } } | undefined)?.director?.scenes ?? {};
    return Object.entries(meta).map(([id, m]) => {
      const l = local[id] ?? {};
      const ev = fromEvents[id];
      const base: SceneGen = m.mode === 'motion' || l.reverted ? { phase: 'motion' } : ev && ev.phase !== 'motion' ? ev : l.proposal ? { phase: 'proposed', token: l.proposal.token, reason: l.proposal.reason, estCredits: 25 } : { phase: 'idle' };
      return { id, mode: m.mode, ...base, proposal: l.proposal, error: l.error, busy: !!l.busy };
    });
  }, [comp, fromEvents, local]);

  const review = useCallback(
    async (sceneId: string) => {
      if (!filmId) return;
      patch(sceneId, { busy: true, error: undefined, reverted: false });
      try {
        const r = await api.setMode(filmId, sceneId, 'generate');
        patch(sceneId, { proposal: r.proposal, busy: false });
      } catch (e) {
        const err = e as GenerateApiError;
        patch(sceneId, { busy: false, error: { code: err.body?.error ?? 'error', message: err.body?.message, retryAfterSec: err.body?.retryAfterSec } });
      }
    },
    [api, filmId, patch],
  );

  const approve = useCallback(
    async (sceneId: string) => {
      if (!filmId) return;
      const token = local[sceneId]?.proposal?.token ?? fromEvents[sceneId]?.token;
      if (!token) return;
      patch(sceneId, { busy: true, error: undefined });
      try {
        await api.approve(filmId, sceneId, token);
        patch(sceneId, { busy: false });
      } catch (e) {
        const err = e as GenerateApiError;
        patch(sceneId, { busy: false, error: { code: err.body?.error ?? 'error', message: err.body?.message, retryAfterSec: err.body?.retryAfterSec } });
      }
    },
    [api, filmId, fromEvents, local, patch],
  );

  const keepMotion = useCallback(
    async (sceneId: string) => {
      if (!filmId) return;
      patch(sceneId, { busy: true, error: undefined });
      try {
        await api.setMode(filmId, sceneId, 'motion');
        patch(sceneId, { busy: false, reverted: true, proposal: undefined });
      } catch (e) {
        const err = e as GenerateApiError;
        patch(sceneId, { busy: false, error: { code: err.body?.error ?? 'error', message: err.body?.message } });
      }
    },
    [api, filmId, patch],
  );

  return { scenes, review, approve, keepMotion };
}
