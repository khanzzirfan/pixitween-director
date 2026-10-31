// Owned by S12b. The board tools the showrunner acts through (design.md 6.3). It never edits the timeline itself:
// these tools change the storyboard and the style bible, hand jobs to the crew, and talk to the user.
import { z } from 'zod';
import { jobKindSchema, storyboardOpSchema, styleBibleSchema, WRITING_KINDS, type JobKind, type StoryboardOp } from '@shared/crew';
import type { FilmState } from '@shared/composition';
import type { FilmStore } from '@shared/ports';
import { MAX_GENERATE_SCENES, PRODUCT_SHAPES, type ProductShape, type Storyboard } from '@shared/storyboard';
import type { ToolCtx, ToolDef, ToolResult } from '@shared/tools';
import { newFilmComposition, registerAsset } from '../authoring/api';
import { readDirector, writeDirector } from '../authoring/meta';
import type { Comp } from '../authoring/types';
import { setSceneMode } from '../generate/mode';
import { runRules } from '../review/rules';
import { finishFilm as applyFinish } from './finish-film';
import type { Board } from './board';
import { TERMINAL } from './board';
import { loadEnv } from '../env';
import type { Budget } from './budget';
import type { Inbox } from './inbox';
import type { SceneSnapshot } from './scene-snapshot';
import type { Scheduler } from './scheduler';
import { applyOps, StoryboardOpError } from './storyboard-ops';
import { syncComposition } from './sync';

/** What the showrunner's turn did, so the loop can auto-dispatch and the say tool can tell a reply from a note. */
export interface TurnState {
  hadUser: boolean;
  /** Scenes that need a builder after this turn's storyboard changes. */
  needsBuilder: Set<string>;
  /** Scenes the showrunner itself dispatched a writing job for this turn. */
  dispatched: Set<string>;
}
export const newTurn = (hadUser = false): TurnState => ({ hadUser, needsBuilder: new Set(), dispatched: new Set() });

export interface CrewCtx {
  filmId: string;
  films: FilmStore;
  board: Board;
  scheduler: Scheduler;
  budget: Budget;
  inbox: Inbox;
  emit: ToolCtx['emit'];
  /** Who is changing the storyboard: the showrunner, or the user's card edit. */
  source: 'showrunner' | 'user';
  /** CREW_TAKES_MAX */
  takesMax: number;
  /** CREW_MAX_FIXES_PER_SCENE */
  maxFixes?: number;
  /** Scene ids removed so far, so a new scene never takes a removed scene's id. */
  removedIds: Set<string>;
  /** The tool context of the film, for the rules and the S7 propose flow. */
  toolCtx: ToolCtx;
  /** A tool context for another film (a take's child film). */
  makeToolCtx?(filmId: string): ToolCtx;
  turn: TurnState;
  /** Reads the scene snapshot a job saved before it started (S12a persist). */
  snapshots?: { load(jobId: string): Promise<SceneSnapshot | undefined> };
  /** Filled by the takes module (S12c). */
  takes?: { pick(args: { takeFilmId: string; reason: string }): Promise<ToolResult> };
  /** The S7 propose step. Defaults to the real proposeGenerate tool. */
  propose?(sceneId: string): Promise<ToolResult>;
  /** Public browser subscribers for this film; the critic skips capture when it is 0. */
  subscriberCount?(filmId: string): number;
  /** Extra continuity checks beyond the S5a rules (S12c). */
  extraChecks?(comp: Comp): Promise<Array<{ kind: string; sceneId: string }>>;
}

const fail = (error: string): ToolResult => ({ ok: false, error });
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Empty storyboard for a film that has none yet, so the first reviseStoryboard can add the scenes. */
function blankStoryboard(film: FilmState): Storyboard {
  return {
    title: (film.title ?? film.brief.text).slice(0, 80) || 'Untitled film',
    aspect: film.aspect,
    durationSec: 0,
    palette: film.styleBible?.palette ?? ['#1f2937'],
    scenes: [],
  };
}

function blankComposition(film: FilmState, sb: Storyboard): Comp {
  let c = newFilmComposition({ aspect: film.aspect, title: sb.title, palette: sb.palette });
  const product = film.assets.find((a) => a.id === film.brief.productAssetId);
  if (product) c = registerAsset(c, { id: product.id, kind: 'image', src: product.url, width: product.width, height: product.height });
  return c;
}

export interface Revision {
  rev: number;
  needsBuilder: string[];
  needsMode: string[];
  added: string[];
  removed: string[];
}

/** Applies storyboard ops: validates, cancels jobs of removed scenes, syncs the composition, saves the storyboard and announces it. */
export async function reviseStoryboard(crew: CrewCtx, ops: StoryboardOp[], extra: { productShape?: ProductShape } = {}): Promise<Revision> {
  const film = await crew.films.get(crew.filmId);
  const before = film.storyboard ?? blankStoryboard(film);
  const userTurn = crew.turn.hadUser || crew.source === 'user';
  // a scene the director asked for may only be removed in a user turn
  if (!userTurn) {
    for (const op of ops) {
      if (op.op === 'remove' && before.scenes.find((s) => s.id === op.sceneId)?.requestedBy === 'user')
        throw new StoryboardOpError(`${op.sceneId} was asked for by the director; ask before removing it`);
    }
  }
  // mark what this user turn adds or updates; a later showrunner-only turn cannot throw it away
  const marked: StoryboardOp[] = userTurn
    ? ops.map((op) =>
        op.op === 'add'
          ? { ...op, scene: { ...op.scene, requestedBy: 'user' as const } }
          : op.op === 'update'
            ? { ...op, patch: { ...op.patch, requestedBy: 'user' as const } }
            : op,
      )
    : ops;
  const preview = applyOps(before, marked, [...crew.removedIds]); // throws StoryboardOpError before anything is touched

  // jobs on a scene that is going away stop first, while the scene still exists to roll back to
  for (const id of preview.removed) {
    for (const job of crew.board.list()) if (job.sceneId === id && !TERMINAL.includes(job.status)) await crew.scheduler.cancel(job.id);
  }

  const written = await crew.films.mutate(
    crew.filmId,
    (f) => {
      const base = f.storyboard ?? blankStoryboard(f);
      const r = applyOps(base, marked, [...crew.removedIds]);
      if (extra.productShape) r.storyboard = { ...r.storyboard, productShape: extra.productShape };
      const s = { ...syncComposition((f.composition as Comp | undefined) ?? blankComposition(f, base), base, r.storyboard, r) };
      if (extra.productShape) {
        const meta = readDirector(s.next);
        meta.productShape = extra.productShape;
        s.next = writeDirector(s.next, meta);
      }
      return { next: s.next, data: { r, needsBuilder: s.needsBuilder, needsMode: s.needsMode, rev: (f.storyboardRev ?? 0) + 1 } };
    },
    crew.source === 'user' ? 'user' : 'director',
    `storyboard rev ${(film.storyboardRev ?? 0) + 1}`,
  );
  if (!written.ok) throw new StoryboardOpError(`the composition was refused: ${JSON.stringify(written.issues).slice(0, 300)}`);
  const { r, needsBuilder, needsMode, rev } = written.data;
  for (const id of r.removed) crew.removedIds.add(id);
  await crew.films.update(crew.filmId, { storyboard: r.storyboard, title: r.storyboard.title, storyboardRev: rev });
  crew.emit({ type: 'storyboard.revised', rev, source: crew.source, ops: marked, storyboard: r.storyboard });
  if (film.status === 'planning') {
    // the first revision turns planning into building
    await crew.films.update(crew.filmId, { status: 'building' });
    crew.emit({ type: 'film.status', status: 'building' });
  }
  for (const id of needsBuilder) crew.turn.needsBuilder.add(id);
  return { rev, needsBuilder, needsMode, added: r.added, removed: r.removed };
}

const sceneIdsOf = async (crew: CrewCtx): Promise<string[]> => (await crew.films.get(crew.filmId)).storyboard?.scenes.map((s) => s.id) ?? [];

/** Showrunner-ordered fixes per scene. After this many, the showrunner leaves the finding and says why. */
export const MAX_FIXES_PER_SCENE = 3;
const maxFixes = (crew: CrewCtx): number => crew.maxFixes ?? loadEnv().CREW_MAX_FIXES_PER_SCENE;

const NEEDS_SCENE: JobKind[] = [...WRITING_KINDS, 'take', 'critique'];

export interface FinishGate {
  pass: boolean;
  block: string[];
  accepted: string[];
}

/** What finish would do right now, without changing the film. Used by the tool, the done nudge and auto-finish. */
export async function finishGate(crew: CrewCtx, ctx: ToolCtx): Promise<FinishGate> {
  const open = crew.board.list().filter((j) => !TERMINAL.includes(j.status));
  if (open.length) return { pass: false, block: [`jobs still running: ${open.map((j) => j.id).join(', ')}`], accepted: [] };
  const film = await crew.films.get(crew.filmId);
  if (!film.composition || !film.storyboard?.scenes.length) return { pass: false, block: ['nothing is built yet: plan and build scenes before finish'], accepted: [] };
  const { findings } = await runRules(film.composition as Comp, ctx.assets, { ...(film.storyboard ? { storyboard: film.storyboard } : {}) });
  const errors = [
    ...findings.filter((f) => f.severity === 'error').map((f) => ({ kind: f.kind, sceneId: f.sceneId })),
    ...((await crew.extraChecks?.(film.composition as Comp)) ?? []),
  ];
  const block: string[] = [];
  const accepted: string[] = [];
  for (const e of errors) {
    const fixes = crew.board.list().filter((j) => j.kind === 'fix' && j.sceneId === e.sceneId && j.status !== 'cancelled').length;
    if (fixes >= maxFixes(crew)) accepted.push(`${e.sceneId} ${e.kind} (${fixes} fixes tried)`);
    else block.push(`${e.kind} (${e.sceneId})`);
  }
  return { pass: block.length === 0, block, accepted };
}

/** Makes the film ready when the gate passes; the accepted findings are listed in the note. */
export async function finishFilm(crew: CrewCtx, ctx: ToolCtx, summary: string): Promise<ToolResult> {
  const gate = await finishGate(crew, ctx);
  if (!gate.pass) return fail(gate.block.join(', '));
  await applyFinish(crew.films, crew.filmId, ctx.assets);
  await crew.films.update(crew.filmId, { status: 'ready' });
  crew.emit({ type: 'film.status', status: 'ready' });
  const text = gate.accepted.length ? `${summary} accepted: ${gate.accepted.join(', ')}` : summary;
  crew.emit({ type: 'showrunner.say', kind: 'note', text });
  return { ok: true };
}

export function createBoardTools(crew: CrewCtx): ToolDef[] {
  const defs: ToolDef[] = [];
  const def = <A>(d: ToolDef<A>) => defs.push(d as ToolDef);

  def({
    name: 'setStyleBible',
    description: 'Set the film style bible once, before the first build. It keeps every scene consistent. type.font must be one of sans, serif, rounded, condensed or mono.',
    params: styleBibleSchema,
    async run(_ctx, bible) {
      await crew.films.update(crew.filmId, { styleBible: bible });
      crew.emit({ type: 'style.bible', bible });
      return { ok: true };
    },
  });

  def({
    name: 'reviseStoryboard',
    description:
      "Add, update, remove or move scenes. 2 to 6 scenes, 2 to 8 seconds each, 30 seconds at most. The whole batch applies or none of it. Give every added scene an id (lowercase, like 'hero') and use that id in after, dispatch and proposeGenerate; a scene added without one gets s1, s2 and so on.",
    params: z.object({ ops: z.array(storyboardOpSchema).min(1).max(8), reason: z.string().max(200).optional(), productShape: z.enum(PRODUCT_SHAPES).optional() }),
    async run(_ctx, a) {
      try {
        const r = await reviseStoryboard(crew, a.ops, { ...(a.productShape ? { productShape: a.productShape } : {}) });
        return { ok: true, data: r };
      } catch (e) {
        return fail(e instanceof StoryboardOpError ? e.message : `could not revise the storyboard: ${message(e)}`);
      }
    },
  });

  def({
    name: 'dispatch',
    description: 'Give one worker one job. brief is a concrete instruction; reason is one short line the user reads.',
    params: z.object({
      kind: jobKindSchema,
      sceneId: z.string().optional(),
      brief: z.string().min(1).max(600),
      reason: z.string().min(1).max(200),
      takes: z.number().int().min(1).max(8).optional(),
      dependsOn: z.array(z.string()).optional(),
    }),
    async run(_ctx, a) {
      if (NEEDS_SCENE.includes(a.kind) && !a.sceneId) return fail(`${a.kind} needs a sceneId`);
      if (a.sceneId && !(await sceneIdsOf(crew)).includes(a.sceneId)) return fail(`unknown scene ${a.sceneId}`);
      if (a.kind === 'fix' && a.sceneId) {
        const fixes = crew.board.list().filter((j) => j.kind === 'fix' && j.sceneId === a.sceneId && j.status !== 'cancelled').length;
        if (fixes >= maxFixes(crew)) return fail(`fix cap reached for ${a.sceneId}: leave its findings and say why in one line`);
      }
      for (const dep of a.dependsOn ?? []) if (!crew.board.get(dep)) return fail(`unknown job ${dep} in dependsOn`);
      const base = { origin: 'showrunner' as const, brief: a.brief, reason: a.reason, ...(a.sceneId ? { sceneId: a.sceneId } : {}), ...(a.dependsOn ? { dependsOn: a.dependsOn } : {}) };
      const ids: string[] = [];
      try {
        if (a.kind === 'take') {
          const n = a.takes ?? crew.takesMax;
          if (n < 2 || n > crew.takesMax) return fail(`takes must be 2 to ${crew.takesMax} (CREW_TAKES_MAX)`);
          for (const label of (['A', 'B', 'C'] as const).slice(0, n)) ids.push((await crew.scheduler.dispatch({ ...base, kind: 'take', takeLabel: label })).id);
        } else {
          ids.push((await crew.scheduler.dispatch({ ...base, kind: a.kind })).id);
        }
      } catch (e) {
        return fail(message(e));
      }
      if (a.sceneId && WRITING_KINDS.includes(a.kind)) crew.turn.dispatched.add(a.sceneId);
      return { ok: true, data: { jobIds: ids } };
    },
  });

  def({
    name: 'cancel',
    description: 'Cancel a queued or running job. A running job stops and its scene goes back to how it was.',
    params: z.object({ jobId: z.string(), reason: z.string().max(200).optional() }),
    async run(_ctx, a) {
      const job = crew.board.get(a.jobId);
      if (!job) return fail(`unknown job ${a.jobId}`);
      if (TERMINAL.includes(job.status)) return fail(`job ${a.jobId} is already ${job.status}`);
      await crew.scheduler.cancel(a.jobId);
      return { ok: true, data: { status: crew.board.get(a.jobId)?.status } };
    },
  });

  def({
    name: 'pickTake',
    description: 'Choose one take for a scene: its scene replaces the one in the film.',
    params: z.object({ takeFilmId: z.string(), reason: z.string().max(200).optional() }),
    async run(_ctx, a) {
      if (!crew.takes) return fail('takes are not available');
      return crew.takes.pick({ takeFilmId: a.takeFilmId, reason: a.reason ?? '' });
    },
  });

  def({
    name: 'proposeGenerate',
    description: 'Offer to make one scene real video. The user approves it; nothing is spent before that.',
    params: z.object({ sceneId: z.string(), reason: z.string().min(1).max(240) }),
    async run(ctx, a) {
      const film = await crew.films.get(crew.filmId);
      const scene = film.storyboard?.scenes.find((s) => s.id === a.sceneId);
      if (!scene) return fail(`unknown scene ${a.sceneId}`);
      if (scene.mode !== 'generate' && (film.storyboard?.scenes.filter((s) => s.mode === 'generate').length ?? 0) >= MAX_GENERATE_SCENES)
        return fail(`at most ${MAX_GENERATE_SCENES} generate scenes`);
      try {
        if (scene.mode !== 'generate') {
          await reviseStoryboard(crew, [{ op: 'update', sceneId: a.sceneId, patch: { mode: 'generate', modeReason: a.reason } }]);
          const done = await crew.films.mutate(crew.filmId, (f) => ({ next: setSceneMode(f.composition as Comp, a.sceneId, 'generate'), data: null }), 'director', `scene ${a.sceneId} to generate`);
          if (!done.ok) return fail('the scene could not be switched to generate');
        }
      } catch (e) {
        return fail(message(e));
      }
      // loaded here: the generate tools pull in the Clippy services, which nothing else in the crew needs
      const propose = crew.propose ?? (async (sceneId: string) => (await import('../tools/generate')).tools[0]!.run(ctx, { sceneId }));
      return propose(a.sceneId);
    },
  });

  def({
    name: 'say',
    description: 'Say one short line to the user.',
    params: z.object({ text: z.string().min(1).max(240) }),
    async run(_ctx, a) {
      crew.emit({ type: 'showrunner.say', kind: crew.turn.hadUser ? 'reply' : 'note', text: a.text });
      return { ok: true };
    },
  });

  def({
    name: 'ask',
    description: 'Ask the user one question with 2 to 4 short answers they can click.',
    params: z.object({ question: z.string().min(1).max(200), options: z.array(z.string().min(1).max(40)).min(2).max(4) }),
    async run(_ctx, a) {
      crew.emit({ type: 'showrunner.say', kind: 'ask', text: a.question, options: a.options });
      return { ok: true };
    },
  });

  def({
    name: 'finish',
    description: 'Declare the film done. Refused while any job is open or continuity reports an error.',
    params: z.object({ summary: z.string().min(1).max(300) }),
    async run(ctx, a) {
      return finishFilm(crew, ctx, a.summary);
    },
  });

  return defs;
}
