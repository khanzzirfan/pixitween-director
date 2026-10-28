import { describe, expectTypeOf, it } from 'vitest';
import type { LlmBackend, MetaClients, SamObject } from './ports';
import type { ToolCtx, ToolDef, ToolResult } from './tools';

describe('ports types', () => {
  it('a minimal object satisfies LlmBackend', () => {
    const b = { id: 'spark', chatWithTools: async () => ({ toolCalls: [], ms: 1 }) } satisfies LlmBackend;
    expectTypeOf(b).toExtend<LlmBackend>();
  });
  it('ToolDef run args are typed', () => {
    expectTypeOf<ToolDef<{ a: number }>['run']>().toEqualTypeOf<(ctx: ToolCtx, args: { a: number }) => Promise<ToolResult>>();
  });
  it('segmentImage returns SamObject[]', () => {
    expectTypeOf<MetaClients['sam']['segmentImage']>().returns.toEqualTypeOf<Promise<SamObject[]>>();
  });
});
