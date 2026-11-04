// Owned by S12c. Tool parameters as JSON Schema for the Meta chat API.
// zod-to-json-schema's OpenAPI 3.0 target writes `exclusiveMinimum: true` next to `minimum: 0`; Meta validates against
// the newer JSON Schema, where the keyword is the number itself, and answers 400 "true is not of type number".
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { ZodTypeAny } from 'zod';

type Json = Record<string, unknown>;

/** `{ minimum: 0, exclusiveMinimum: true }` becomes `{ exclusiveMinimum: 0 }`, and the same for the maximum, at any depth. */
export function numericExclusives(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(numericExclusives);
  if (!node || typeof node !== 'object') return node;
  const out: Json = {};
  for (const [k, v] of Object.entries(node as Json)) out[k] = numericExclusives(v);
  for (const [flag, bound] of [['exclusiveMinimum', 'minimum'], ['exclusiveMaximum', 'maximum']] as const) {
    if (out[flag] === true && typeof out[bound] === 'number') {
      out[flag] = out[bound];
      delete out[bound];
    } else if (out[flag] === false) delete out[flag];
  }
  return out;
}

export function toolParameters(params: ZodTypeAny): object {
  const { $schema: _drop, ...schema } = zodToJsonSchema(params, { target: 'openApi3', $refStrategy: 'none' }) as Json;
  return numericExclusives(schema) as object;
}
