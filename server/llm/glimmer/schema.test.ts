import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { ToolDef } from '@shared/tools';
import { KEYS_HINT, Z_HINT, toOllamaTools } from './schema';

const tool = (name: string, params: z.ZodTypeAny): ToolDef => ({ name, description: `${name} tool`, params, run: async () => ({ ok: true }) });
const props = (t: ReturnType<typeof toOllamaTools>[number]) => t.function.parameters.properties as Record<string, { description?: string }>;

describe('toOllamaTools', () => {
  it('adds the z and keys hints but keeps existing descriptions', () => {
    const [t] = toOllamaTools([tool('setKeyframes', z.object({ layerId: z.string(), z: z.number().optional(), keys: z.array(z.tuple([z.number(), z.number()])), other: z.number().describe('mine') }))]);
    expect(props(t!).z!.description).toBe(Z_HINT);
    expect(props(t!).keys!.description).toBe(KEYS_HINT);
    expect(props(t!).other!.description).toBe('mine');
    const [kept] = toOllamaTools([tool('x', z.object({ keys: z.array(z.number()).describe('mine') }))]);
    expect(props(kept!).keys!.description).toBe('mine');
  });

  it('keeps shape and order, and always gives an object schema', () => {
    const out = toOllamaTools([tool('a', z.object({})), tool('b', z.object({ n: z.number() }))]);
    expect(out.map((t) => t.function.name)).toEqual(['a', 'b']);
    expect(out[0]).toMatchObject({ type: 'function', function: { description: 'a tool', parameters: { type: 'object' } } });
    expect(out[1]!.function.parameters).not.toHaveProperty('$schema');
  });
});
