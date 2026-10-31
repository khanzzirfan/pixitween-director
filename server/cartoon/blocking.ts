// Owned by S16b. The blocking worker: one `block-shot` job stages one scene of a toy-studio film with the stage tools, from the storyboard's beats, cast and cues.
// Same shape as the scene builder (scene-scoped tools, one Spark tool loop), with its own prompt, a short tool list and a check that every cue names a clip the cast can play.
import { ASPECT_SIZES } from '@shared/composition';
import type { Job, StyleBible } from '@shared/crew';
import type { LlmBackend } from '@shared/ports';
import type { ToolCtx, ToolDef, ToolResult } from '@shared/tools';
import { buildScene } from '../agent/build-scene';
import { layerIdsByRole } from '../authoring/api';
import { loadEnv } from '../env';
import { pickBackend } from '../llm/router';
import { renderBibleBlock, renderJobBlock } from '../crew/prompts';
import type { WorkerResult } from '../crew/scheduler';
import type { CrewCtx } from '../crew/showrunner-tools';
import { runTool } from '../tools/registry';
import { scopedRunTool, type RunTool } from '../crew/workers/scope';
import { blockShotPrompt } from './prompts';

export const BLOCK_TOOLS = ['addStage', 'placeActor', 'cueClip', 'moveActor', 'placeProp', 'placeStageProduct', 'setLightCue', 'setText', 'restyleText'];

export interface BlockOptions {
  /** Which model answers this job. Defaults to Spark; tests supply a scripted one. */
  backendFor?: (job: Job) => LlmBackend;
}

const abortError = () => Object.assign(new Error('The job was stopped'), { name: 'AbortError' });

/** Refuses a cue for a clip the film does not have, with the list of ones it has, so the model can repair in one turn. */
export function clipGuard(clips: ReadonlyArray<{ id: string; name: string; assetId?: string }> | undefined, run: RunTool): RunTool {
  if (!clips) return run;
  const names = clips.map((c) => c.name);
  return async (ctx, name, args): Promise<ToolResult> => {
    if (name === 'cueClip' && args && typeof args === 'object') {
      const a = args as { clip?: unknown; clipAssetId?: unknown };
      const byName = typeof a.clip === 'string' && clips.some((c) => c.name.toLowerCase() === a.clip!.toString().toLowerCase());
      const byAsset = typeof a.clipAssetId === 'string' && clips.some((c) => c.assetId === a.clipAssetId || c.id === a.clipAssetId);
      if (!byName && !byAsset) return { ok: false, error: `no clip '${String(a.clip ?? a.clipAssetId)}' in this film. Clips you can use: ${names.join(', ') || 'none'}` };
    }
    if (name === 'cueClip' && args && typeof args === 'object') {
      // a clip that is its own file is cued by its asset, not by a name the character model has no clip for
      const a = args as { clip?: unknown; clipAssetId?: unknown } & Record<string, unknown>;
      const hit = typeof a.clip === 'string' ? clips.find((c) => c.name.toLowerCase() === (a.clip as string).toLowerCase() && c.assetId) : undefined;
      if (hit && !a.clipAssetId) {
        const { clip: _name, ...rest } = a;
        return run(ctx, name, { ...rest, clipAssetId: hit.assetId });
      }
    }
    return run(ctx, name, args);
  };
}

const luma = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
};
/** The darkest palette colour reads on the light toy-room backdrop. */
const darkest = (palette: string[]): string => [...palette].filter((c) => /^#[0-9a-fA-F]{6}$/.test(c)).sort((a, b) => luma(a) - luma(b))[0] ?? '#1b1b1b';

/** The scene needs a floor to stand on and its title before the model starts; a missing one is added with the same defaults as the scene builder. */
export async function ensureBasics(ctx: ToolCtx, sceneId: string, text: string | undefined, palette: string[], bible?: StyleBible): Promise<void> {
  const comp = (await ctx.films.get(ctx.filmId)).composition;
  if (!comp) return;
  if (!layerIdsByRole(comp, 'bg', sceneId).length) await runTool(ctx, 'addLayer', { sceneId, role: 'bg', kind: 'shape', fill: palette[0] ?? '#f4ead5' });
  if (text && !layerIdsByRole(comp, 'headline', sceneId).length) await runTool(ctx, 'addLayer', { sceneId, role: 'headline', kind: 'text', text, style: { color: darkest(palette), ...(bible ? { font: bible.type.font, weight: bible.type.weight } : {}) } });
}

export async function runBlockJob(job: Job, signal: AbortSignal, crew: CrewCtx, o: BlockOptions = {}): Promise<WorkerResult> {
  const sceneId = job.sceneId;
  if (!sceneId) throw new Error(`${job.kind} needs a scene`);
  if (signal.aborted) throw abortError();
  const film = await crew.films.get(job.filmId);
  const scene = film.storyboard?.scenes.find((s) => s.id === sceneId);
  if (!scene) throw new Error(`unknown scene ${sceneId}`);
  const palette = film.styleBible?.palette ?? film.storyboard!.palette;
  const dims = ASPECT_SIZES[film.aspect];
  const spentBefore = crew.toolCtx.ledger.total(job.filmId);
  const backend = (o.backendFor ?? (() => pickBackend('build')))(job);
  const model = loadEnv().META_SPARK_MODEL;
  const worker = job.worker ?? 'blocker';
  crew.board.update(job.id, { model });
  crew.emit({ type: 'crew.agent', lane: 'builder', worker, state: 'working', jobId: job.id, model });

  const ctx: ToolCtx = { ...crew.toolCtx, signal, scope: { sceneId }, source: 'director' };
  try {
    await ensureBasics(ctx, sceneId, scene.text, palette, film.styleBible);
    // cast members are made before the shot; each has its own film-wide asset id, which is what the stage tools take
    const made = (kind: string) => (film.cast ?? []).filter((m) => m.kind === kind && m.status === 'ready' && m.assetId);
    const wanted = new Set(scene.castIds ?? []);
    const characters = made('character').filter((m) => !wanted.size || wanted.has(m.id));
    const r = await buildScene({
      ctx,
      backend,
      scene,
      canvas: { ...dims, aspect: film.aspect },
      palette,
      product: { assetId: film.brief.productAssetId, width: dims.width, height: dims.height },
      systemPrompt: blockShotPrompt({
        scene,
        toolNames: BLOCK_TOOLS,
        clips: (film.clips ?? []).map((c) => c.name),
        assets: {
          actors: characters.map((m) => `${m.id} (assetId ${m.assetId})`),
          props: made('prop').map((m) => `${m.id} (assetId ${m.assetId})`),
          sets: made('set').map((m) => `${m.assetId} (${m.description.replace(/^a toy-diorama backdrop: /, '')})`),
        },
        fps: 30,
      }),
      extraSystem: [film.styleBible ? renderBibleBlock(film.styleBible) : '', renderJobBlock(job)].filter(Boolean).join('\n'),
      toolFilter: (t: ToolDef) => BLOCK_TOOLS.includes(t.name),
      maxTurns: 8,
      signal,
      run: clipGuard(film.clips, scopedRunTool(sceneId)),
    });
    if (r.aborted || signal.aborted) throw abortError();
    if (!r.calls || r.stalled) throw new Error(r.failures.at(-1) ? `blocker stalled: ${r.failures.at(-1)}`.slice(0, 280) : 'blocker made no progress');
    const after = await crew.films.get(job.filmId);
    return { summary: `${r.calls} tool calls, ${r.ok} ok`, version: after.version, costUsd: Math.max(0, crew.toolCtx.ledger.total(job.filmId) - spentBefore), model };
  } finally {
    crew.emit({ type: 'crew.agent', lane: 'builder', worker, state: 'idle', jobId: job.id, model });
  }
}
