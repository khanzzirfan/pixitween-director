// Owned by S12c. The blind critic (design.md 5.9): asks the browser for frames of a finished scene, then judges only what is on screen.
// It is given the frames, the measured text boxes and the rule facts, and never the intent, the brief or the style bible.
import type { Finding } from '../../review/types';
import { loadEnv } from '../../env';
import { listScenes } from '../../review/geometry';
import { measuredForRules, type MeasuredBoxes } from '../../review/compare';
import { runRules } from '../../review/rules';
import { ReviewError, visualReview, type Reviewer, type VisualFrame } from '../../review/visual';
import type { Comp } from '../../authoring/types';
import { createId } from '../ids';
import type { WorkerResult } from '../scheduler';
import type { CrewCtx } from '../showrunner-tools';
import type { Job } from '@shared/crew';

/** The same fractions of a scene the browser's own capture plan uses (web/src/capture/plan.ts). */
export const CAPTURE_FRACTIONS = [0.2, 0.5, 0.8] as const;
const CAPTURE_FPS = 30;

export interface CapturedFrames {
  frames: VisualFrame[];
  textBoxes?: MeasuredBoxes;
}

interface Waiting {
  filmId: string;
  sceneId: string;
  resolve(c: CapturedFrames): void;
}
const waiting = new Map<string, Waiting>();

/** True while a critique job is waiting for the frames of this request. */
export const isWaitingCapture = (requestId: string): boolean => waiting.has(requestId);

/** The film and scene a waiting request belongs to, so the upload handler can check it matches. */
export const waitingCapture = (requestId: string): { filmId: string; sceneId: string } | undefined => {
  const w = waiting.get(requestId);
  return w ? { filmId: w.filmId, sceneId: w.sceneId } : undefined;
};

/** Hands the browser's frames to the job that asked for them. False when nothing is waiting for this request. */
export function resolveCapture(requestId: string, captured: CapturedFrames): boolean {
  const w = waiting.get(requestId);
  if (!w) return false;
  waiting.delete(requestId);
  w.resolve(captured);
  return true;
}

export interface CriticOptions {
  /** Overrides CREW_CAPTURE_TIMEOUT_MS. */
  timeoutMs?: number;
  /** The vision model. Defaults to the router's reviewer; tests supply a scripted one. */
  reviewer?: Reviewer;
}

const abortError = () => Object.assign(new Error('The job was stopped'), { name: 'AbortError' });
const round = (n: number) => Math.round(n * 10000) / 10000;

/** Scene-relative seconds, rounded to whole capture frames: the moments the browser should photograph. */
export function captureTimes(durationSec: number): number[] {
  return CAPTURE_FRACTIONS.map((f) => round(Math.round(durationSec * CAPTURE_FPS * f) / CAPTURE_FPS));
}

const lineOf = (sceneId: string, atSec: number | undefined, kind: string, evidence: string) => `${sceneId}${atSec !== undefined ? ` at ${atSec}s` : ''} ${kind}: ${evidence}`;

export async function runCriticJob(job: Job, signal: AbortSignal, crew: CrewCtx, o: CriticOptions = {}): Promise<WorkerResult> {
  const sceneId = job.sceneId;
  if (!sceneId) throw new Error('critique needs a scene');
  if (signal.aborted) throw abortError();
  const film = await crew.films.get(job.filmId);
  const comp = film.composition as Comp | undefined;
  const scene = comp ? listScenes(comp).find((s) => s.sceneId === sceneId) : undefined;
  if (!comp || !scene) throw new Error(`unknown scene ${sceneId}`);
  const spentBefore = crew.toolCtx.ledger.total(job.filmId);
  crew.emit({ type: 'crew.agent', lane: 'critic', worker: 'critic', state: 'working', jobId: job.id });

  try {
    const requestId = createId('cap');
    const timesSec = captureTimes(scene.durationFrames / comp.fps);
    const timeoutMs = o.timeoutMs ?? loadEnv().CREW_CAPTURE_TIMEOUT_MS;
    const captured = await new Promise<CapturedFrames | undefined>((resolve, reject) => {
      const done = (c: CapturedFrames | undefined) => {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        resolve(c);
      };
      const onAbort = () => {
        waiting.delete(requestId);
        clearTimeout(timer);
        reject(abortError());
      };
      const timer = setTimeout(() => {
        waiting.delete(requestId);
        done(undefined);
      }, timeoutMs);
      waiting.set(requestId, { filmId: job.filmId, sceneId, resolve: done });
      signal.addEventListener('abort', onAbort, { once: true });
      crew.board.update(job.id, { status: 'awaiting-frames' });
      crew.emit({ type: 'capture.request', requestId, sceneId, timesSec });
    });

    const measured = captured?.textBoxes ? measuredForRules(comp, captured.textBoxes) : undefined;
    const rules = await runRules(comp, { read: (id: string) => crew.toolCtx.assets.read(id) }, { sceneIds: [sceneId], ...(film.storyboard ? { storyboard: film.storyboard } : {}), ...(measured ? { deps: { measuredTextBoxes: measured } } : {}) });
    const lines: string[] = [];
    for (const f of rules.findings as Finding[]) {
      crew.emit({ type: 'review.finding', sceneId, kind: f.kind, atSec: f.atSec, evidence: f.evidence, deterministic: true });
      lines.push(lineOf(sceneId, f.atSec, f.kind, f.evidence));
    }

    let summary = captured ? '' : 'no browser connected; rules only';
    if (captured) {
      try {
        const result = await visualReview({
          ctx: crew.toolCtx,
          sceneId,
          frames: captured.frames,
          findings: rules.findings.map((f) => f.evidence),
          layerSummary: [],
          layerIds: [],
          tools: [],
          blind: true,
          measured: measured ? Object.entries(measured).map(([id, b]) => `${id}: left ${Math.round(b.left)}, top ${Math.round(b.top)}, right ${Math.round(b.right)}, bottom ${Math.round(b.bottom)}`) : [],
          ...(o.reviewer ? { reviewer: o.reviewer } : {}),
        });
        for (const issue of result.verdict.issues) {
          crew.emit({ type: 'review.finding', sceneId, kind: issue.kind, atSec: issue.atSec, evidence: issue.evidence, deterministic: false });
          lines.push(lineOf(sceneId, issue.atSec, issue.kind, issue.evidence));
        }
      } catch (e) {
        const message = e instanceof ReviewError || e instanceof Error ? e.message : String(e);
        crew.emit({ type: 'error', where: 'review.visual', message });
        summary = `frames could not be judged (${message}); rules only`;
      }
    }

    // one item per scene: the showrunner decides what to do about it
    if (lines.length) crew.inbox.push({ id: createId('i'), at: new Date().toISOString(), from: 'critic', jobId: job.id, text: lines.join('; ').slice(0, 1900) });
    return {
      summary: (summary || (lines.length ? `${lines.length} finding${lines.length > 1 ? 's' : ''}` : 'no findings')).slice(0, 300),
      costUsd: Math.max(0, crew.toolCtx.ledger.total(job.filmId) - spentBefore),
    };
  } finally {
    crew.emit({ type: 'crew.agent', lane: 'critic', worker: 'critic', state: 'idle', jobId: job.id });
  }
}
