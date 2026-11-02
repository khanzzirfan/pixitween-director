import { describe, expect, it } from 'vitest';
import { motionDocJsonSchema } from './jsonSchema';
import type { JsonSchemaObject } from './jsonSchema';

const LAYER_TYPES = ['image', 'text', 'shape', 'group', 'three'];

function branchesOf(node: JsonSchemaObject | undefined): JsonSchemaObject[] {
  return node?.anyOf ?? [];
}

/** The schema of one layer, which is the union of the five layer types. */
function layerDefinition(schema: JsonSchemaObject): JsonSchemaObject {
  const items = schema.properties?.layers?.items;
  if (!items) throw new Error('the schema has no layers');
  return items;
}

/** The type values the layer definition lists, in the order it lists them. */
function layerTypeValues(schema: JsonSchemaObject): string[] {
  return branchesOf(layerDefinition(schema))
    .map((branch) => {
      const type = branch.properties?.type;
      if (!type) return [];
      if (type.enum) return type.enum.filter((value): value is string => typeof value === 'string');
      return typeof type.const === 'string' ? [type.const] : [];
    })
    .flat();
}

describe('motionDocJsonSchema', () => {
  it('is an object that requires the doc fields', () => {
    const schema = motionDocJsonSchema();
    expect(schema.type).toBe('object');
    expect(schema.required).toEqual(expect.arrayContaining(['version', 'width', 'height', 'duration', 'layers']));
  });

  it('defines every property it requires', () => {
    const schema = motionDocJsonSchema();
    const names = Object.keys(schema.properties ?? {});
    for (const name of schema.required ?? []) expect(names).toContain(name);
  });

  it('lists the five layer types', () => {
    expect(layerTypeValues(motionDocJsonSchema())).toEqual(LAYER_TYPES);
  });

  it('is under 200 KB', () => {
    expect(JSON.stringify(motionDocJsonSchema()).length).toBeLessThan(200 * 1024);
  });

  it('names the five layer types in its description', () => {
    const description = motionDocJsonSchema().description ?? '';
    for (const type of LAYER_TYPES) expect(description).toContain(type);
  });

  it('refuses unknown keys on a layer', () => {
    for (const branch of branchesOf(layerDefinition(motionDocJsonSchema()))) {
      expect(branch.additionalProperties).toBe(false);
    }
  });

  it('describes a group as holding layers', () => {
    const group = branchesOf(layerDefinition(motionDocJsonSchema())).find((branch) => branch.properties?.type?.const === 'group');
    const children = group?.properties?.children;
    if (!children) throw new Error('the group layer has no children');
    expect(branchesOf(children.items).map((branch) => branch.properties?.type?.const)).toEqual(LAYER_TYPES);
  });

  it('has no $ref, so it stays correct when a tool definition embeds it', () => {
    expect(JSON.stringify(motionDocJsonSchema())).not.toContain('"$ref"');
  });

  it('gives every caller its own copy', () => {
    const first = motionDocJsonSchema();
    const layers = first.properties?.layers;
    if (!layers) throw new Error('the schema has no layers');
    layers.description = 'changed';
    expect(motionDocJsonSchema().properties?.layers?.description).not.toBe('changed');
  });
});
