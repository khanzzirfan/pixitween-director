// Owned by S12c. A crew worker may touch its own scene only (design.md 5.8), so parallel builders never step on each other.
import type { ToolCtx, ToolResult } from '@shared/tools';
import { runTool } from '../../tools/registry';

/** Tools that change the film's structure, which no scene worker may do. */
export const STRUCTURE_TOOLS = ['removeScene', 'swapScenes', 'addScene'];

export const outOfScope = (sceneId: string): ToolResult => ({ ok: false, error: `out of scope: this job owns scene ${sceneId} only` });

/** True when a call stays inside the scene: every sceneId is the scene, every layerId starts with `<scene>:`. */
export function inScope(sceneId: string, name: string, args: unknown): boolean {
  if (STRUCTURE_TOOLS.includes(name)) return false;
  if (!args || typeof args !== 'object') return true;
  const a = args as { sceneId?: unknown; layerId?: unknown };
  if (a.sceneId !== undefined && a.sceneId !== sceneId) return false;
  if (typeof a.layerId === 'string' && !a.layerId.startsWith(`${sceneId}:`)) return false;
  return true;
}

export type RunTool = (ctx: ToolCtx, name: string, args: unknown) => Promise<ToolResult>;

/** A tool runner for one scene. The refusal goes back to the model like any tool error. `run` is the real runner unless a test supplies one. */
export function scopedRunTool(sceneId: string, run: RunTool = runTool): RunTool {
  return async (ctx, name, args) => (inScope(sceneId, name, args) ? run(ctx, name, args) : outOfScope(sceneId));
}
