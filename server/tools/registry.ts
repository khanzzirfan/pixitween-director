import type { ToolCtx, ToolDef, ToolResult } from '@shared/tools';
import { tools as art } from './art';
import { tools as authoring } from './authoring';
import { tools as edit } from './edit';
import { tools as generate } from './generate';
import { tools as review } from './review';

export { makeToolCtx } from '../http/deps';
export type { AppDeps, ToolCtxDeps } from '../http/deps';

export class RegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RegistryError';
  }
}

export interface Registry {
  all(): ToolDef[];
  get(name: string): ToolDef | undefined;
  run(ctx: ToolCtx, name: string, args: unknown): Promise<ToolResult>;
}

export function createRegistry(arrays: ToolDef[][]): Registry {
  const all = (): ToolDef[] => {
    const flat = arrays.flat();
    const seen = new Set<string>();
    const dup = new Set<string>();
    for (const t of flat) (seen.has(t.name) ? dup : seen).add(t.name);
    if (dup.size) throw new RegistryError(`duplicate tool names: ${[...dup].join(', ')}`);
    return flat;
  };
  const get = (name: string) => all().find((t) => t.name === name);

  return {
    all,
    get,
    async run(ctx, name, args) {
      const def = get(name);
      let result: ToolResult;
      if (!def) result = { ok: false, error: `unknown_tool: ${name}` };
      else {
        const parsed = def.params.safeParse(args);
        if (!parsed.success) {
          const i = parsed.error.issues[0]!;
          result = { ok: false, error: `${i.path.join('.') || '(args)'}: ${i.message}`, zodIssues: parsed.error.issues };
        } else {
          try {
            result = await def.run(ctx, parsed.data);
          } catch (e) {
            result = { ok: false, error: e instanceof Error ? e.message : String(e) };
          }
        }
      }
      ctx.emit({
        type: 'tool.call',
        name,
        args,
        ok: result.ok,
        ...(!result.ok ? { error: result.error } : {}),
        ...(result.ok && result.version !== undefined ? { version: result.version } : {}),
      });
      return result;
    },
  };
}

const registry = createRegistry([authoring, art, review, edit, generate]);
export const allTools = (): ToolDef[] => registry.all();
export const getTool = (name: string): ToolDef | undefined => registry.get(name);
export const runTool = (ctx: ToolCtx, name: string, args: unknown): Promise<ToolResult> => registry.run(ctx, name, args);
