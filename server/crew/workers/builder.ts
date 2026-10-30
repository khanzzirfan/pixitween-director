// Owned by S12c. The scene builder: one worker for every job kind that writes a scene (design.md 5.8).
// build, rebuild, restyle, edit and fix run S3b's buildScene on the job's scene only; revert restores a snapshot with no model.
import { WRITING_KINDS, type Job, type StyleBible } from '@shared/crew';
import { ASPECT_SIZES } from '@shared/composition';
import type { LlmBackend } from '@shared/ports';
import type { ToolCtx, ToolDef } from '@shared/tools';
import { EDIT_ONLY_TOOLS, buildScene } from '../../agent/build-scene';
import { ensureSceneBasics } from '../../agent/scene-basics';
import { removeLayer } from '../../authoring/api';
import { readDirector } from '../../authoring/meta';
import type { Comp } from '../../authoring/types';
import { loadEnv } from '../../env';
import { getLocalMode } from '../../llm/local-mode';
import { pickBackend } from '../../llm/router';
import { BUILDER_DIRECTION, renderBibleBlock, renderJobBlock, renderOutlineBlock } from '../prompts';
import { applyTextLane, fitTextToSafeArea } from '../text-lane';
import { restoreScene } from '../scene-snapshot';
import type { WorkerResult } from '../scheduler';
import type { CrewCtx } from '../showrunner-tools';
import { scopedRunTool } from './scope';

export class SceneGoneError extends Error {
  constructor(sceneId: string) {
    super(`scene ${sceneId} is not in the storyboard`);
    this.name = 'SceneGoneError';
  }
}

export interface BuilderOptions {
  /** Which model answers this job. Defaults to the router; tests supply a scripted one. */
  backendFor?: (job: Job) => LlmBackend;
}

const abortError = () => Object.assign(new Error('The job was stopped'), { name: 'AbortError' });
const SAFE_AREA = 'SAFE AREA: keep all text and the product inside a 5 % inset from every canvas edge, including while it animates.';
const EDIT_KINDS = ['edit', 'fix'];

function defaultBackend(job: Job): LlmBackend {
  // small edits may run on the local model in Local mode; building and restyling need new art, so they stay on Spark
  return EDIT_KINDS.includes(job.kind) ? pickBackend('edit', { local: getLocalMode() }) : pickBackend('build');
}

/** Removes every layer of the scene except a camera layer, in one commit. */
async function clearScene(crew: CrewCtx, job: Job, sceneId: string): Promise<void> {
  const r = await crew.films.mutate(
    job.filmId,
    (f) => {
      let c = f.composition as Comp;
      for (const [id, m] of Object.entries(readDirector(c).layers)) if (m.sceneId === sceneId && m.role !== 'camera') c = removeLayer(c, id);
      return { next: c, data: null };
    },
    'director',
    `clear ${sceneId} (${job.id})`,
  );
  if (!r.ok) throw new Error('the scene could not be cleared for a rebuild');
}

/** The deterministic lane: bible type, then the rest position inside the safe area. A no-op writes no version. */
async function runTextLane(crew: CrewCtx, job: Job, sceneId: string, bible: StyleBible | undefined): Promise<void> {
  const film = await crew.films.get(job.filmId);
  const c = film.composition as Comp | undefined;
  if (!c || !film.storyboard?.scenes.some((s) => s.id === sceneId)) return;
  const styled = bible ? applyTextLane(c, sceneId, bible) : c;
  const fitted = fitTextToSafeArea(styled, sceneId);
  if (styled === c && !fitted.moved.length) return;
  const written = await crew.films.mutate(job.filmId, (f) => {
    const base = f.composition as Comp;
    const lane = fitTextToSafeArea(bible ? applyTextLane(base, sceneId, bible) : base, sceneId);
    return { next: lane.comp, data: null };
  }, 'director', `text lane ${sceneId}`);
  if (!written.ok) throw new Error('the text lane was refused by the film');
}

async function revert(crew: CrewCtx, job: Job, sceneId: string): Promise<WorkerResult> {
  const previous = crew.board
    .list()
    .filter((j) => j.id !== job.id && j.sceneId === sceneId && j.filmId === job.filmId && WRITING_KINDS.includes(j.kind) && j.kind !== 'revert' && j.status === 'done')
    .at(-1);
  const snap = previous ? await crew.snapshots?.load(previous.id) : undefined;
  if (!previous || !snap) throw new Error('nothing to revert to');
  const r = await crew.films.mutate(job.filmId, (f) => ({ next: restoreScene(f.composition as Comp, sceneId, snap), data: null }), 'director', `revert ${sceneId} to before ${previous.id}`);
  if (!r.ok) throw new Error('the reverted scene was refused');
  return { summary: `back to before ${previous.id}`, version: r.version };
}

export async function runBuilderJob(job: Job, signal: AbortSignal, crew: CrewCtx, o: BuilderOptions = {}): Promise<WorkerResult> {
  const sceneId = job.sceneId;
  if (!sceneId) throw new Error(`${job.kind} needs a scene`);
  if (signal.aborted) throw abortError();
  if (job.kind === 'revert') return revert(crew, job, sceneId);

  const film = await crew.films.get(job.filmId);
  const scene = film.storyboard?.scenes.find((s) => s.id === sceneId);
  if (!scene) throw new SceneGoneError(sceneId);
  const product = film.assets.find((a) => a.id === film.brief.productAssetId);
  const dims = ASPECT_SIZES[film.aspect];
  const palette = film.styleBible?.palette ?? film.storyboard!.palette;
  const spentBefore = crew.toolCtx.ledger.total(job.filmId);

  if (job.kind === 'rebuild-scene') await clearScene(crew, job, sceneId);

  const backend = (o.backendFor ?? defaultBackend)(job);
  const local = backend.id === 'glimmer';
  const model = local ? loadEnv().GLIMMER_MODEL : loadEnv().META_SPARK_MODEL;
  const lane = local ? 'local' : 'builder';
  const worker = local ? 'local' : (job.worker ?? 'builder');
  if (local) crew.board.update(job.id, { worker, model });
  else crew.board.update(job.id, { model });
  crew.emit({ type: 'crew.agent', lane, worker, state: 'working', jobId: job.id, model });

  const ctx: ToolCtx = { ...crew.toolCtx, signal, scope: { sceneId }, source: job.kind === 'build-scene' || job.kind === 'rebuild-scene' ? 'director' : 'chat' };
  const building = job.kind === 'build-scene' || job.kind === 'rebuild-scene';
  try {
    const r = await buildScene({
      ctx,
      backend,
      scene,
      canvas: { ...dims, aspect: film.aspect },
      palette,
      product: { assetId: film.brief.productAssetId, width: product?.width ?? dims.width, height: product?.height ?? dims.height },
      extraSystem: [film.styleBible ? renderBibleBlock(film.styleBible) : '', film.storyboard ? renderOutlineBlock(film.storyboard, sceneId) : '', SAFE_AREA, BUILDER_DIRECTION, renderJobBlock(job)].filter(Boolean).join('\n'),
      toolFilter: building ? (t: ToolDef) => !EDIT_ONLY_TOOLS.includes(t.name) : () => true,
      signal,
      run: scopedRunTool(sceneId),
    });
    if (r.aborted || signal.aborted) throw abortError();
    if (building) await ensureSceneBasics({ ctx, scene, product: { assetId: film.brief.productAssetId }, palette });
    if (!r.calls || r.stalled) throw new Error(r.failures.at(-1) ? `builder stalled: ${r.failures.at(-1)}`.slice(0, 280) : 'builder made no progress');
    await runTextLane(crew, job, sceneId, film.styleBible);
    const after = await crew.films.get(job.filmId);
    return { summary: `${r.calls} tool calls, ${r.ok} ok`, version: after.version, costUsd: Math.max(0, crew.toolCtx.ledger.total(job.filmId) - spentBefore), model };
  } finally {
    crew.emit({ type: 'crew.agent', lane, worker, state: 'idle', jobId: job.id, model });
  }
}
