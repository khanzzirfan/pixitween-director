import type { AepCompositionJson } from 'reacthub-pixitweenjs';
import type { Storyboard } from '@shared/storyboard';
import type { ToolCtx } from '@shared/tools';
import { allTools } from '../tools/registry';
import { applyFixes } from './apply';
import { layerBoxAt, listScenes } from './geometry';
import { clearFixes, recordFixes } from './fix-log';
import { runRules, suggestFix } from './rules';
import type { Finding, Box } from './types';
import {
  ReviewError,
  visualReview,
  type VisualFrame,
  type ProposedFix,
  type VisualVerdict,
  type RefusedFix,
  type DroppedIssue,
} from './visual';

export const MAX_ROUNDS = 2;

export interface VisualResult {
  verdict: VisualVerdict;
  refused: RefusedFix[];
  dropped: DroppedIssue[];
}
export type VisualCheck = (o: {
  sceneId: string;
  frames: VisualFrame[];
  findings: string[];
  layerSummary: string[];
  layerIds: string[];
  /** 1 when an earlier scene of this review already needed a retry, so a bad model does not double the bill on every scene. */
  maxAttempts?: number;
}) => Promise<VisualResult>;

export interface SceneReview {
  sceneId: string;
  reverted: boolean;
  /** Visible edits that were kept: deterministic fixes plus visual fixes that were not reverted. */
  applied: number;
  unresolved: Finding[];
  skipped?: string;
}

export interface ReviewOptions {
  storyboard?: Storyboard;
  visual?: VisualCheck;
  /** Text boxes the browser measured; the rules use the ones whose layers are not animated. */
  measured?: Record<string, Box>;
  /** Shared by the scenes of one review; set to 0 after the first malformed answer. */
  retries?: { left: number };
}

const errorsOf = (findings: Finding[]) => findings.filter((f) => f.severity === 'error').length;

function sceneLayers(comp: AepCompositionJson, sceneId: string): { ids: string[]; summary: string[] } {
  const layers = ((comp.precomps?.[sceneId] as { layers?: Array<{ id: string; kind: string }> } | undefined)?.layers ?? []).map((l) => ({
    id: l.id,
    kind: l.kind,
  }));
  return { ids: layers.map((l) => l.id), summary: layers.map((l) => `- ${l.id} (${l.kind})`) };
}

async function check(ctx: ToolCtx, sceneId: string, opts: ReviewOptions): Promise<{ findings: Finding[]; comp: AepCompositionJson }> {
  const film = await ctx.films.get(ctx.filmId);
  const comp = film.composition;
  if (!comp) throw new ReviewError('no-frames', 'film has no composition yet');
  const deps = opts.measured ? { measuredTextBoxes: opts.measured } : undefined;
  const { findings } = await runRules(
    comp,
    { read: (id: string) => ctx.assets.read(id) },
    { sceneIds: [sceneId], storyboard: opts.storyboard, deps },
  );
  return { findings, comp };
}

function fixesFor(findings: Finding[], comp: AepCompositionJson, sceneId: string, storyboard?: Storyboard): ProposedFix[] {
  const fps = listScenes(comp).find((s) => s.sceneId === sceneId)?.fps ?? 30;
  const fixes: ProposedFix[] = [];
  for (const finding of findings) {
    let boxes: Record<string, Box> | undefined;
    if (finding.layerId) {
      try {
        boxes = { [finding.layerId]: layerBoxAt(comp, finding.layerId, Math.round((finding.atSec ?? 0) * fps)).box };
      } catch {
        boxes = undefined;
      }
    }
    const fix = suggestFix(finding, { comp, sceneId, boxes, storyboard });
    if (fix) fixes.push(fix);
  }
  return fixes;
}

const noteOf = (f: ProposedFix) => `${f.tool} ${(f.args as { layerId?: string }).layerId ?? ''}`.trim();

/** Identity of a fix for de-duplication: the tool and its full arguments, so two edits to one layer are not confused. */
const keyOf = (f: ProposedFix) => `${f.tool} ${JSON.stringify(f.args, Object.keys(f.args).sort())}`;

/** Worse means more errors, or the same errors and more findings overall (new warnings count). */
const worse = (before: Finding[], after: Finding[]) =>
  errorsOf(after) > errorsOf(before) || (errorsOf(after) === errorsOf(before) && after.length > before.length);

const compositionOf = async (ctx: ToolCtx): Promise<AepCompositionJson> => {
  const comp = (await ctx.films.get(ctx.filmId)).composition;
  if (!comp) throw new ReviewError('no-frames', 'film has no composition yet');
  return comp;
};

/** Review one scene: deterministic rules, one visual pass, then a regression check that undoes visual fixes which made things worse. */
export async function reviewScene(ctx: ToolCtx, sceneId: string, frames: VisualFrame[], opts: ReviewOptions = {}): Promise<SceneReview> {
  const scene = listScenes(await compositionOf(ctx)).find((s) => s.sceneId === sceneId);
  if (scene?.mode === 'generate') return { sceneId, reverted: false, applied: 0, unresolved: [], skipped: 'generate-mode scene' };
  const result: SceneReview = { sceneId, reverted: false, applied: 0, unresolved: [] };

  // F1: deterministic findings and their fixes
  const first = await check(ctx, sceneId, opts);
  for (const f of first.findings)
    ctx.emit({ type: 'review.finding', sceneId, kind: f.kind, atSec: f.atSec, evidence: f.evidence, deterministic: true });
  const detFixes = fixesFor(first.findings, first.comp, sceneId, opts.storyboard);
  const det = await applyFixes(ctx, detFixes);
  for (const a of det.applied) ctx.emit({ type: 'review.fix', sceneId, note: noteOf(a.fix) });
  if (det.failed) ctx.emit({ type: 'error', where: 'review.fix', message: `${noteOf(det.failed.fix)}: ${det.failed.error}` });
  result.applied += det.applied.length;
  const applied = new Set(det.applied.map((a) => keyOf(a.fix)));

  // F2: after the deterministic fixes
  const second = await check(ctx, sceneId, opts);
  let final = second.findings;

  // Visual pass, once per scene. A failure is reported and the deterministic fixes stay.
  if (frames.length) {
    const layers = sceneLayers(second.comp, sceneId);
    let visual: VisualResult | undefined;
    try {
      const run: VisualCheck = opts.visual ?? ((o) => visualReview({ ctx, ...o, tools: allTools() }));
      visual = await run({
        sceneId,
        frames,
        findings: second.findings.map((f) => f.evidence),
        layerSummary: layers.summary,
        layerIds: layers.ids,
        maxAttempts: opts.retries && opts.retries.left <= 0 ? 1 : 2,
      });
    } catch (e) {
      if (e instanceof ReviewError && e.code === 'spark-invalid' && opts.retries) opts.retries.left = 0;
      const message = e instanceof ReviewError || e instanceof Error ? e.message : String(e);
      ctx.emit({ type: 'error', where: 'review.visual', message });
    }
    if (visual) {
      const nearest = (sec: number) =>
        frames.reduce((best, f) => (Math.abs(f.atSec - sec) < Math.abs(best.atSec - sec) ? f : best), frames[0]!);
      for (const issue of visual.verdict.issues)
        ctx.emit({ type: 'review.finding', sceneId, kind: issue.kind, atSec: issue.atSec, evidence: issue.evidence, deterministic: false });
      // A fix with no grounded issue behind it has no frame to be checked against, so it is not applied.
      const visualFixes = visual.verdict.issues.length ? visual.verdict.fixes.filter((f) => !applied.has(keyOf(f))) : [];
      const versionBefore = (await ctx.films.get(ctx.filmId)).version;
      const vis = await applyFixes(ctx, visualFixes);
      const versionAfter = (await ctx.films.get(ctx.filmId)).version;
      if (vis.failed) ctx.emit({ type: 'error', where: 'review.fix', message: `${noteOf(vis.failed.fix)}: ${vis.failed.error}` });
      if (vis.applied.length) {
        // F3: did the visual fixes make things worse?
        const third = await check(ctx, sceneId, opts);
        final = third.findings;
        if (worse(second.findings, third.findings)) {
          const count = errorsOf(third.findings) === errorsOf(second.findings) ? (f: Finding[]) => f.length : errorsOf;
          const note = `reverted: fixes increased findings (${count(second.findings)} -> ${count(third.findings)})`;
          const current = (await ctx.films.get(ctx.filmId)).version;
          if (current !== versionAfter) {
            // someone else edited the film during the check; undoing would throw their edit away too
            final = third.findings;
            ctx.emit({ type: 'error', where: 'review.fix', message: 'film changed during review; visual fixes were not reverted' });
          } else {
            // the version before our fixes is the parent of the first one; stop if undo makes no progress
            let version = current;
            while (version > versionBefore) {
              const next = await ctx.films.undo(ctx.filmId);
              if (next >= version) break;
              version = next;
            }
            result.reverted = true;
            final = second.findings;
            ctx.emit({ type: 'review.fix', sceneId, note });
          }
        } else {
          result.applied += vis.applied.length;
          // Each fix is tied to the issue about its layer, else the first grounded issue; the before frame is the one that showed it.
          const issues = visual.verdict.issues;
          const records = vis.applied.map((a) => {
            const layerId = (a.fix.args as { layerId?: string }).layerId;
            const issue = (layerId && issues.find((i) => i.where === layerId)) || issues[0];
            return { sceneId, atSec: issue?.atSec, note: noteOf(a.fix), beforeFrame: issue ? nearest(issue.atSec).id : undefined };
          });
          for (const r of records) ctx.emit({ type: 'review.fix', ...r });
          recordFixes(ctx.filmId, records);
        }
      }
    }
  }

  if (final.length) {
    result.unresolved = final;
    ctx.emit({
      type: 'review.finding',
      sceneId,
      kind: 'unresolved',
      evidence: `unresolved after ${MAX_ROUNDS} rounds: ${final.map((f) => f.kind).join(', ')}`,
      deterministic: true,
    });
  }
  return result;
}

/** Review every requested scene under the film's `reviewing` status, then return to `ready`. */
export async function runReview(
  ctx: ToolCtx,
  o: { sceneIds?: string[]; frames: Record<string, VisualFrame[]> } & ReviewOptions,
): Promise<SceneReview[]> {
  const film = await ctx.films.get(ctx.filmId);
  const comp = film.composition;
  if (!comp) throw new ReviewError('no-frames', 'film has no composition yet');
  const ids = listScenes(comp)
    .map((s) => s.sceneId)
    .filter((id) => !o.sceneIds || o.sceneIds.includes(id));
  await ctx.films.update(ctx.filmId, { status: 'reviewing' });
  ctx.emit({ type: 'film.status', status: 'reviewing' });
  clearFixes(ctx.filmId); // fixes from an earlier review no longer match the new frames
  const retries = o.retries ?? { left: 1 };
  const results: SceneReview[] = [];
  let failure: unknown;
  try {
    for (const id of ids) results.push(await reviewScene(ctx, id, o.frames[id] ?? [], { ...o, retries }));
  } catch (e) {
    failure = e;
  }
  // restoring the status must not replace the review's own error
  try {
    await ctx.films.update(ctx.filmId, { status: 'ready' });
    ctx.emit({ type: 'film.status', status: 'ready' });
  } catch (e) {
    if (failure === undefined) throw e;
    console.error('review cleanup failed:', e);
  }
  if (failure !== undefined) throw failure;
  return results;
}

/** Rules only: no Spark call and no version change. Unknown scene ids are reported as skipped. */
export async function reviewDeterministic(
  ctx: ToolCtx,
  sceneIds?: string[],
): Promise<{ findings: Finding[]; skipped: Array<{ sceneId: string; reason: string }> }> {
  const comp = await compositionOf(ctx);
  const known = listScenes(comp).map((s) => s.sceneId);
  const unknown = (sceneIds ?? []).filter((id) => !known.includes(id)).map((sceneId) => ({ sceneId, reason: 'unknown scene' }));
  const targets = (sceneIds ?? known).filter((id) => known.includes(id));
  const { findings } = await runRules(comp, { read: (id: string) => ctx.assets.read(id) }, { sceneIds: targets });
  for (const f of findings)
    ctx.emit({ type: 'review.finding', sceneId: f.sceneId, kind: f.kind, atSec: f.atSec, evidence: f.evidence, deterministic: true });
  return { findings, skipped: unknown };
}
