// Owned by S12c. Takes (design.md 5.10): the same scene built in different ways in child films, a thumbnail and a score each,
// and a pick that splices the chosen scene into the parent.
// One take job is one take. The showrunner dispatches 2 or 3 of them (A, B, C); each builds in its own child film, on its own worker.
import type { Job } from '@shared/crew';
import type { ToolResult } from '@shared/tools';
import sharp from 'sharp';
import type { Comp, Obj } from '../authoring/types';
import { flattenScene } from '../generate/flatten';
import { runRules } from '../review/rules';
import { visualReview, type Reviewer } from '../review/visual';
import type { BuilderOptions } from './workers/builder';
import { spliceScene } from './scene-snapshot';
import type { WorkerResult } from './scheduler';
import type { CrewCtx } from './showrunner-tools';

/** Fixed hints, so the takes really differ and the reason is explainable on screen. */
export const TAKE_HINTS = { A: 'as planned', B: 'bolder: closer framing, a stronger camera move', C: 'calmer: wider, more empty space' } as const;
export const THUMB_WIDTH = 640;

/** What a take scored against: rule findings cost 2 points, blind-critic findings 1. */
export interface TakeFindings {
  rules: number;
  critic: number;
  note?: string;
}

export interface TakesOptions {
  /** The builder for a take's rebuild. Defaults to the real one. */
  builder?: (job: Job, signal: AbortSignal, crew: CrewCtx, o?: BuilderOptions) => Promise<WorkerResult>;
  builderOptions?: BuilderOptions;
  /** Counts the findings for a finished take. Defaults to the S5a rules and a blind look at the thumbnail. */
  findings?: (crew: CrewCtx, childId: string, sceneId: string, thumb: Buffer) => Promise<TakeFindings>;
  reviewer?: Reviewer;
}

export const scoreOf = (f: TakeFindings): number => Math.max(0, 10 - 2 * f.rules - f.critic);

const abortError = () => Object.assign(new Error('The job was stopped'), { name: 'AbortError' });
const precomps = (c: Comp) => (c.precomps ?? {}) as Record<string, Obj>;

/** The one scene whose precomp differs between two compositions of the same film, if there is exactly one. */
function differingScene(parent: Comp, child: Comp): string | undefined {
  const ids = Object.keys(precomps(child)).filter((id) => JSON.stringify(precomps(child)[id]) !== JSON.stringify(precomps(parent)[id]));
  return ids.length === 1 ? ids[0] : undefined;
}

export function createTakes(o: TakesOptions = {}) {
  /** Which scene and label each child film is a take of. Rebuilt from the compositions after a restart. */
  const index = new Map<string, { sceneId: string; label: string }>();
  // loaded on first use: the builder pulls in every tool module, which a route registration does not need
  const builder: NonNullable<TakesOptions['builder']> = o.builder ?? (async (...args) => (await import('./workers/builder')).runBuilderJob(...args));

  async function defaultFindings(crew: CrewCtx, childId: string, sceneId: string, thumb: Buffer): Promise<TakeFindings> {
    const childCtx = crew.makeToolCtx?.(childId) ?? crew.toolCtx;
    const child = await crew.films.get(childId);
    const { findings } = await runRules(child.composition as Comp, { read: (id: string) => childCtx.assets.read(id) }, { sceneIds: [sceneId], ...(child.storyboard ? { storyboard: child.storyboard } : {}) });
    let critic = 0;
    let note: string | undefined;
    try {
      const r = await visualReview({
        ctx: childCtx,
        sceneId,
        frames: [{ image: thumb, atSec: 0 }],
        findings: findings.map((f) => f.evidence),
        layerSummary: [],
        layerIds: [],
        tools: [],
        blind: true,
        maxAttempts: 1,
        ...(o.reviewer ? { reviewer: o.reviewer } : {}),
      });
      critic = r.verdict.issues.length;
    } catch (e) {
      note = `not judged by vision: ${e instanceof Error ? e.message : String(e)}`.slice(0, 120);
    }
    return { rules: findings.length, critic, ...(note ? { note } : {}) };
  }

  /** The worker for a take job: a child film, one rebuild of the scene in it, a thumbnail and a score. */
  async function start(job: Job, signal: AbortSignal, crew: CrewCtx): Promise<WorkerResult> {
    const sceneId = job.sceneId;
    if (!sceneId) throw new Error('a take needs a scene');
    if (signal.aborted) throw abortError();
    const label = (job.takeLabel ?? 'A') as keyof typeof TAKE_HINTS;
    crew.emit({ type: 'crew.agent', lane: 'builder', worker: job.worker ?? 'builder', state: 'working', jobId: job.id, note: `take ${label}` });
    try {
      return await buildTake(job, signal, crew, sceneId, label);
    } finally {
      crew.emit({ type: 'crew.agent', lane: 'builder', worker: job.worker ?? 'builder', state: 'idle', jobId: job.id });
    }
  }

  async function buildTake(job: Job, signal: AbortSignal, crew: CrewCtx, sceneId: string, label: keyof typeof TAKE_HINTS): Promise<WorkerResult> {
    if (!crew.makeToolCtx) throw new Error('takes need a way to open another film');
    const parent = await crew.films.get(job.filmId);
    const base = parent.composition as Comp | undefined;
    if (!base) throw new Error('the film has no composition to take from');

    const child = await crew.films.create({
      aspect: parent.aspect,
      brief: parent.brief,
      assets: parent.assets,
      title: `${parent.title ?? 'Film'} (take ${label})`,
      parentId: parent.id,
      crew: false,
      ...(parent.storyboard ? { storyboard: parent.storyboard } : {}),
      ...(parent.styleBible ? { styleBible: parent.styleBible } : {}),
    });
    const committed = await crew.films.commit(child.id, base, 'director', `take ${label} base`);
    if (!committed.ok) throw new Error('the take could not start from the current film');
    await crew.films.update(child.id, { status: 'ready' });
    index.set(child.id, { sceneId, label });
    if (signal.aborted) throw abortError();

    // the rebuild runs here, in the child film, so the take holds one worker and never waits for a second one
    const childCtx = crew.makeToolCtx(child.id);
    const rebuild: Job = { ...job, kind: 'rebuild-scene', filmId: child.id, brief: `${job.brief} (variation ${label}, ${TAKE_HINTS[label]})` };
    const built = await builder(rebuild, signal, { ...crew, toolCtx: childCtx, emit: childCtx.emit }, o.builderOptions);
    if (signal.aborted) throw abortError();

    const done = await crew.films.get(child.id);
    const comp = done.composition as Comp;
    const png = await flattenScene(childCtx, comp as never, sceneId, { width: comp.width, height: comp.height }, Math.floor(((precomps(comp)[sceneId]?.durationInFrames as number | undefined) ?? 0) / 2));
    const thumb = await sharp(png).resize({ width: THUMB_WIDTH }).png().toBuffer();
    const asset = await crew.toolCtx.assets.put(thumb, 'image/png', { role: 'frame', sceneId, filmId: parent.id });
    const f = await (o.findings ?? defaultFindings)(crew, child.id, sceneId, thumb);
    const score = scoreOf(f);
    crew.emit({ type: 'take.ready', jobId: job.id, takeOf: job.takeOf ?? sceneId, sceneId, label, takeFilmId: child.id, thumbAssetId: asset.id, score, ...(f.note ? { note: f.note } : {}) });
    return { summary: `take ${label} scored ${score}`, costUsd: built.costUsd, version: built.version, model: built.model };
  }

  /** Splices the scene of a take into the parent and has it checked. */
  async function pick(crew: CrewCtx, a: { takeFilmId: string; reason: string }): Promise<ToolResult> {
    let child;
    try {
      child = await crew.films.get(a.takeFilmId);
    } catch {
      return { ok: false, error: `unknown film ${a.takeFilmId}` };
    }
    if (child.parentId !== crew.filmId) return { ok: false, error: 'not a take of this film' };
    const childComp = child.composition as Comp | undefined;
    if (!childComp) return { ok: false, error: 'the take has no composition' };
    const parent = await crew.films.get(crew.filmId);
    const known = index.get(child.id);
    const sceneId = known?.sceneId ?? (parent.composition ? differingScene(parent.composition as Comp, childComp) : undefined);
    if (!sceneId) return { ok: false, error: 'cannot tell which scene this take is of' };
    const label = known?.label ?? (/take ([ABC])\)/.exec(child.title ?? '')?.[1] ?? '?');
    const r = await crew.films.mutate(crew.filmId, (f) => ({ next: spliceScene(f.composition as Comp, sceneId, childComp), data: null }), 'director', `take ${label} of ${sceneId}`);
    if (!r.ok) return { ok: false, error: 'the take was refused by the film' };
    for (const kind of ['continuity', 'critique'] as const)
      await crew.scheduler.dispatch({ kind, sceneId, origin: 'auto', brief: `check ${sceneId} after take ${label}`, reason: `after picking take ${label}` });
    return { ok: true, version: r.version, data: { sceneId, label } };
  }

  return { start, pick, index };
}
