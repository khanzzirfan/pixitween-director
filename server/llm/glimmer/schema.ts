import { zodToJsonSchema } from 'zod-to-json-schema';
import type { ToolDef } from '@shared/tools';

export type OllamaTool = { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } };

export const Z_HINT = 'Depth. Larger = further from the camera; the background has the largest z.';
export const KEYS_HINT = 'Keyframes as [timeSec, value] pairs; timeSec is seconds from the scene start.';
const HINTS: Record<string, string> = { z: Z_HINT, keys: KEYS_HINT };

/** Adds the two hints S1 showed Glimmer needs, wherever a property named z or keys has no description of its own. */
export function augmentToolSchemas(node: unknown): void {
  if (Array.isArray(node)) return node.forEach(augmentToolSchemas);
  if (typeof node !== 'object' || node === null) return;
  const obj = node as Record<string, unknown>;
  const props = obj.properties;
  if (props && typeof props === 'object') {
    for (const [name, prop] of Object.entries(props as Record<string, Record<string, unknown>>)) {
      if (HINTS[name] && prop && typeof prop === 'object' && !prop.description) prop.description = HINTS[name];
    }
  }
  for (const v of Object.values(obj)) augmentToolSchemas(v);
}

export function toOllamaTools(tools: ToolDef[]): OllamaTool[] {
  return tools.map((t) => {
    const { $schema: _drop, ...parameters } = zodToJsonSchema(t.params, { target: 'openApi3', $refStrategy: 'none' }) as Record<string, unknown>;
    if (parameters.type === undefined) parameters.type = 'object';
    augmentToolSchemas(parameters);
    return { type: 'function', function: { name: t.name, description: t.description, parameters } };
  });
}
