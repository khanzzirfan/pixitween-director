import type { FilmId, FilmState, FilmVersion } from '@shared/composition';
import type { LlmBackend } from '@shared/ports';
import type { ToolCtx, ToolDef, ToolResult } from '@shared/tools';
import { loadEnv } from '../env';
import { runRules } from '../review/rules';
import { pickBackend } from '../llm/router';
import { allTools, runTool } from '../tools/registry';
import { assistantMessageFrom, toolResultMessage } from '../llm/messages';
import { buildEditMessages } from './edit-prompt';
import { editCostUsd, type TokenUsage } from './edit-cost';

export const STUB_OWNER = 'S6' as const;
export const MAX_TURNS = 4,
  MAX_CALLS_PER_TURN = 12;
export interface EditSelection {
  sceneId?: string;
  layerId?: string;
}
export interface RunEditInput {
  message: string;
  selection?: EditSelection;
  local?: boolean;
}
export interface EditOutcome {
  ok: boolean;
  turns: number;
  toolCalls: number;
  applied: number;
  failed: number;
  versionBefore: number;
  versionAfter: number;
  reply?: string;
  error?: string;
}
export class FilmBusyError extends Error {
  constructor() {
    super('film_busy');
    this.name = 'FilmBusyError';
  }
}
export class FilmNotReadyError extends Error {
  constructor() {
    super('film_not_ready');
    this.name = 'FilmNotReadyError';
  }
}
const locks = new Map<FilmId, true>();
export function assertEditable(film: FilmState, versions: FilmVersion[], now = Date.now()): void {
  if (!film.composition) throw new FilmNotReadyError();
  if (film.status === 'planning' || film.status === 'building') {
    const at = versions.at(-1)?.at;
    if (at && now - Date.parse(at) < 10 * 60_000) throw new FilmBusyError();
  }
}
async function status(ctx: ToolCtx, value: 'building' | 'ready') {
  await ctx.films.update(ctx.filmId, { status: value });
  ctx.emit({ type: 'film.status', status: value });
}
export async function runPostEditRules(ctx: ToolCtx, film: FilmState): Promise<void> {
  if (!film.composition) return;
  try {
    const result = await runRules(film.composition, { read: (id: string) => ctx.assets.read(id) });
    for (const f of result.findings)
      ctx.emit({ type: 'review.finding', sceneId: f.sceneId, kind: f.kind, atSec: f.atSec, evidence: f.evidence, deterministic: true });
  } catch (e) {
    // the edit itself is already committed; surface the failed check instead of hiding it
    ctx.emit({ type: 'error', where: 'post-edit-rules', message: e instanceof Error ? e.message : String(e) });
  }
}
export async function runEditWithCtx(
  ctx: ToolCtx,
  input: RunEditInput,
  deps: { backend?: LlmBackend; tools?: ToolDef[] } = {},
): Promise<EditOutcome> {
  if (locks.has(ctx.filmId)) throw new FilmBusyError();
  locks.set(ctx.filmId, true);
  const outcome: EditOutcome = { ok: false, turns: 0, toolCalls: 0, applied: 0, failed: 0, versionBefore: 0, versionAfter: 0 };
  try {
    let film = await ctx.films.get(ctx.filmId);
    const versions = await ctx.films.versions(ctx.filmId);
    assertEditable(film, versions);
    if (film.status === 'building' || film.status === 'planning') {
      await ctx.films.update(ctx.filmId, { status: 'ready' });
      film = { ...film, status: 'ready' };
    }
    outcome.versionBefore = film.version;
    outcome.versionAfter = film.version;
    await status(ctx, 'building');
    const comp = film.composition!;
    const messages = buildEditMessages({ comp, selection: input.selection, message: input.message });
    const backend =
      deps.backend ??
      pickBackend('edit', {
        local: input.local,
        onFallback: (i) => ctx.emit({ type: 'error', where: 'llm.fallback', message: `${i.from} -> ${i.to}: ${i.reason}` }),
      });
    const tools = deps.tools ?? allTools();
    let failedInTurn = false;
    let usedCalls = 0;
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      outcome.turns++;
      let r;
      try {
        r = await backend.chatWithTools(messages, tools, { parallelHint: true });
      } catch (e) {
        const err = e as Error & { status?: number };
        ctx.emit({ type: 'error', where: 'edit', status: err.status, message: err.message });
        outcome.error = err.message;
        break;
      }
      const reply = r.content?.trim();
      if (reply) outcome.reply = reply;
      ctx.emit({ type: 'agent.turn', backend: backend.id, ms: r.ms, calls: r.toolCalls.length, ...(reply ? { reply } : {}) });
      const model = backend.id === 'glimmer' ? 'muse-glimmer' : loadEnv().META_SPARK_MODEL;
      if (r.usage) {
        const u = r.usage as TokenUsage;
        const usd = editCostUsd(model, u);
        const ins = u.prompt_tokens ?? u.input_tokens ?? u.promptTokens ?? 0,
          outs = u.completion_tokens ?? u.output_tokens ?? u.completionTokens ?? 0;
        ctx.ledger.add(ctx.filmId, model, `${ins}+${outs} tokens`, usd);
      }
      if (!r.toolCalls.length) {
        outcome.ok = outcome.applied > 0;
        break;
      }
      const appliedResults: ToolResult[] = [];
      for (const [i, call] of r.toolCalls.entries()) {
        outcome.toolCalls++;
        if (usedCalls >= MAX_CALLS_PER_TURN) {
          if (i === MAX_CALLS_PER_TURN)
            ctx.emit({ type: 'tool.call', name: call.name, args: call.args, ok: false, error: 'ignored: too many calls' });
          outcome.failed++;
          appliedResults.push({ ok: false, error: 'ignored: too many calls' });
          continue;
        }
        usedCalls++;
        const result = await runTool(ctx, call.name, call.args);
        appliedResults.push(result);
        if (result.ok) {
          outcome.applied++;
          outcome.versionAfter = result.version ?? outcome.versionAfter;
        } else {
          outcome.failed++;
          failedInTurn = true;
        }
      }
      if (!failedInTurn && appliedResults.every((x) => x.ok)) {
        outcome.ok = outcome.applied > 0;
        break;
      }
      messages.push(assistantMessageFrom({ content: r.content, toolCalls: r.toolCalls }));
      for (let i = 0; i < r.toolCalls.length; i++) {
        const x = appliedResults[i]!;
        messages.push(toolResultMessage(r.toolCalls[i]!, x.ok ? { ok: true } : { ok: false, error: x.error }));
      }
      failedInTurn = false;
    }
    if (outcome.turns === MAX_TURNS && outcome.failed) {
      ctx.emit({ type: 'error', where: 'edit', message: 'gave up after 4 turns' });
      outcome.error = 'gave up after 4 turns';
      outcome.ok = false;
    }
    if (outcome.applied) {
      const final = await ctx.films.get(ctx.filmId);
      await runPostEditRules(ctx, final);
    }
    return outcome;
  } finally {
    try {
      await status(ctx, 'ready');
    } catch {
      /* preserve loop result */
    }
    locks.delete(ctx.filmId);
  }
}
export async function runEdit(
  filmId: FilmId,
  message: string,
  selection?: EditSelection,
  opts?: { local?: boolean },
): Promise<EditOutcome> {
  if (!boundDeps) throw new Error('edit dependencies not bound');
  const ctx = boundDeps.makeToolCtx(filmId);
  return runEditWithCtx(ctx, { message, selection, local: opts?.local });
}
let boundDeps: { makeToolCtx(filmId: string): ToolCtx } | undefined;
export function bindEditDeps(deps: { makeToolCtx(filmId: string): ToolCtx }): void {
  boundDeps = deps;
}
