import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { allTools } from '../tools/registry';
import { numericExclusives, toolParameters } from './tool-schema';

describe('toolParameters', () => {
  it('writes a positive number as exclusiveMinimum: 0, not as the OpenAPI boolean', () => {
    const p = toolParameters(z.object({ size: z.number().positive(), n: z.number().min(1).max(5).optional() })) as { properties: Record<string, Record<string, unknown>> };
    expect(p.properties.size).toEqual({ type: 'number', exclusiveMinimum: 0 });
    expect(p.properties.n).toMatchObject({ minimum: 1, maximum: 5 });
  });

  it('does the same for a negative number and inside nested objects and arrays', () => {
    const p = toolParameters(z.object({ a: z.object({ b: z.array(z.number().negative()) }) }));
    expect(JSON.stringify(p)).toContain('"exclusiveMaximum":0');
    expect(JSON.stringify(p)).not.toMatch(/"exclusive(Minimum|Maximum)":(true|false)/);
  });

  it('leaves a schema with no exclusives alone, and has no $schema key', () => {
    const p = toolParameters(z.object({ id: z.string() }));
    expect(p).toEqual({ type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false });
  });

  it('numericExclusives drops a false flag and ignores a flag with no bound', () => {
    expect(numericExclusives({ exclusiveMinimum: false, minimum: 3 })).toEqual({ minimum: 3 });
    expect(numericExclusives({ exclusiveMinimum: true })).toEqual({ exclusiveMinimum: true });
  });

  it('no tool the model is offered carries a boolean exclusive bound (Meta rejects them with a 400)', () => {
    for (const tool of allTools()) expect(JSON.stringify(toolParameters(tool.params)), tool.name).not.toMatch(/"exclusive(Minimum|Maximum)":(true|false)/);
  });
});
