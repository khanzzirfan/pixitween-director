import { loadEnv } from '../env';
import type { Aspect } from '@shared/composition';
import type { ChatMessage, LlmBackend, ToolCall } from '@shared/ports';
import type { ToolCtx, ToolDef, ToolResult } from '@shared/tools';
import type { Scene } from '@shared/storyboard';
import { priceSpark } from '../pricing';
import { assistantMessageFrom, toolResultMessage } from '../llm/messages';
import { allTools, runTool } from '../tools/registry';
import { buildScenePrompt } from './prompts/director';

export const STUB_OWNER = 'S3b' as const;
export const EDIT_ONLY_TOOLS = ['removeLayer', 'reorderLayer', 'removeScene', 'swapScenes', 'setSceneDuration'];
export interface BuildSceneOptions {
  ctx: ToolCtx;
  backend: LlmBackend;
  scene: Scene;
  canvas: { width: number; height: number; aspect: Aspect };
  palette: string[];
  product: { assetId: string; width: number; height: number };
  maxTurns?: number;
  /** Replaces the generated system prompt (the toy-studio blocker has its own rules). */
  systemPrompt?: string;
  /** Appended to the system prompt: the crew's style bible and job brief. */
  extraSystem?: string;
  /** Replaces the default tool list filter (which drops the edit-only tools). */
  toolFilter?: (tool: ToolDef) => boolean;
  /** Checked before each model turn and each tool call, and passed to the model call. */
  signal?: AbortSignal;
  /** Runs one tool call. The crew passes a scene-scoped runner. */
  run?: (ctx: ToolCtx, name: string, args: unknown) => Promise<ToolResult>;
}
export interface BuildSceneResult {
  turns: number;
  calls: number;
  ok: number;
  failures: string[];
  stalled: boolean;
  /** The signal aborted before the scene was finished. */
  aborted?: boolean;
}

export async function buildScene(o: BuildSceneOptions): Promise<BuildSceneResult> {
  const keep = o.toolFilter ?? ((tool: ToolDef) => !EDIT_ONLY_TOOLS.includes(tool.name));
  const tools: ToolDef[] = allTools().filter(keep);
  const exec = o.run ?? runTool;
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content:
        (o.systemPrompt ??
          buildScenePrompt({
            canvas: o.canvas,
            scene: o.scene,
            palette: o.palette,
            product: o.product,
            toolNames: tools.map((t) => t.name),
          })) + (o.extraSystem ? `\n\n${o.extraSystem}` : ''),
    },
    { role: 'user', content: JSON.stringify(o.scene) },
  ];
  const summary: BuildSceneResult = { turns: 0, calls: 0, ok: 0, failures: [], stalled: false };
  let noProgress = 0;
  for (let turn = 0; turn < (o.maxTurns ?? 6); turn++) {
    if (o.signal?.aborted) {
      summary.aborted = true;
      break;
    }
    let response: Awaited<ReturnType<LlmBackend['chatWithTools']>>;
    try {
      response = await o.backend.chatWithTools(messages, tools, { parallelHint: true, ...(o.signal ? { signal: o.signal } : {}) });
    } catch (e) {
      if (o.signal?.aborted) summary.aborted = true;
      else summary.failures.push(e instanceof Error ? e.message : String(e));
      break;
    }
    summary.turns++;
    o.ctx.emit({ type: 'agent.turn', backend: o.backend.id, ms: response.ms, calls: response.toolCalls.length });
    if (response.usage && typeof response.usage === 'object') {
      const usage = response.usage as { promptTokens?: number; completionTokens?: number };
      if (usage.promptTokens !== undefined && usage.completionTokens !== undefined)
        o.ctx.ledger.add(
          o.ctx.filmId,
          loadEnv().META_SPARK_MODEL,
          `${usage.promptTokens} in / ${usage.completionTokens} out tokens`,
          priceSpark(loadEnv().META_SPARK_MODEL, usage.promptTokens, usage.completionTokens),
        );
    }
    if (!response.toolCalls.length) break;
    const results = [];
    let successes = 0;
    for (const call of response.toolCalls) {
      if (o.signal?.aborted) {
        summary.aborted = true;
        break;
      }
      summary.calls++;
      const result = await exec(o.ctx, call.name, call.args);
      results.push(result);
      if (result.ok) {
        summary.ok++;
        successes++;
      } else summary.failures.push(result.error);
    }
    if (summary.aborted) break;
    messages.push(assistantMessageFrom({ content: response.content, toolCalls: response.toolCalls as ToolCall[] }));
    for (let i = 0; i < response.toolCalls.length; i++) messages.push(toolResultMessage(response.toolCalls[i]!, results[i]));
    noProgress = successes === 0 ? noProgress + 1 : 0;
    if (noProgress >= 2) {
      summary.stalled = true;
      break;
    }
  }
  return summary;
}
