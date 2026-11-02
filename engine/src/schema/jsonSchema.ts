// The MotionDoc as JSON Schema, so a tool author can hand a model the exact shape to write.
// It is generated from the zod schema itself, so it can never drift from what parseMotionDoc accepts.
import { zodToJsonSchema } from 'zod-to-json-schema';
import { MotionDocBaseSchema } from './doc';

/** A JSON Schema node. It is plain JSON, so a caller can pass it to a model as it is. */
export interface JsonSchemaObject {
  type?: string;
  description?: string;
  required?: string[];
  properties?: Record<string, JsonSchemaObject>;
  items?: JsonSchemaObject;
  anyOf?: JsonSchemaObject[];
  enum?: unknown[];
  const?: unknown;
  additionalProperties?: unknown;
  [key: string]: unknown;
}

const DOC_DESCRIPTION = [
  'A MotionDoc is one animated scene: a stage of width x height pixels that lasts duration seconds,',
  'with layers drawn back to front in the order they are listed.',
  'Times are seconds from the start of the doc, and a layer without an end lasts until the doc ends.',
  'Every layer has an id, a start time, an optional end time, a transform (x, y, anchor, scale, rotation, alpha),',
  'optional tweens, optional enter/exit/loop presets and optional effects.',
].join(' ');

/** The union branches of a schema node, or an empty list when it is not a union. */
function branchesOf(node: JsonSchemaObject | undefined): JsonSchemaObject[] {
  return node?.anyOf ?? [];
}

/** A deep copy through JSON, so the result is plain data the caller may edit. */
function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** zod-to-json-schema writes a literal as `const`; most model APIs read a one-value `enum` instead. */
function addEnumsForLiterals(node: unknown): void {
  if (Array.isArray(node)) {
    node.forEach(addEnumsForLiterals);
    return;
  }
  if (!node || typeof node !== 'object') return;
  const record = node as Record<string, unknown>;
  if (record.const !== undefined && record.enum === undefined) record.enum = [record.const];
  Object.values(record).forEach(addEnumsForLiterals);
}

/** The layer types the layer definition lists, in the order it lists them. */
function layerTypeValues(layer: JsonSchemaObject): string[] {
  return branchesOf(layer)
    .map((branch) => {
      const type = branch.properties?.type;
      if (!type) return [];
      if (type.enum) return type.enum.filter((value): value is string => typeof value === 'string');
      return typeof type.const === 'string' ? [type.const] : [];
    })
    .flat();
}

/**
 * zod-to-json-schema warns that it cannot inline the recursive group children and drops them. We
 * put them back ourselves, so that one notice is swallowed; every other warning still gets through.
 */
function withoutRecursionNotice<T>(build: () => T): T {
  const warn = console.warn;
  const kept: unknown[][] = [];
  console.warn = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].startsWith('Recursive reference detected')) return;
    kept.push(args);
  };
  try {
    return build();
  } finally {
    console.warn = warn;
    kept.forEach((args) => warn(...args));
  }
}

function build(): JsonSchemaObject {
  // 'none' keeps the schema free of $ref, so it stays correct wherever it is embedded. A recursive
  // shape cannot be inlined, so the group branch gets the layer union copied into it below.
  const schema = withoutRecursionNotice(
    () => zodToJsonSchema(MotionDocBaseSchema, { target: 'jsonSchema7', $refStrategy: 'none' }) as JsonSchemaObject,
  );
  addEnumsForLiterals(schema);

  const layers = schema.properties?.layers;
  const union = layers?.items;
  if (!layers || !union) throw new Error('the MotionDoc schema has no layers');

  // A group holds layers, so its children get the layer union once. A group inside that copy is
  // left as it is: the union is already described, and a third copy would only cost tokens.
  const group = branchesOf(union).find((branch) => branch.properties?.type?.const === 'group');
  const children = group?.properties?.children;
  if (children) children.items = copy(union);

  const types = layerTypeValues(union);
  schema.description = `${DOC_DESCRIPTION} A layer is one of ${types.join(', ')}.`;
  layers.description = `The layers of the scene, drawn back to front. A layer is one of ${types.join(', ')}.`;
  return schema;
}

let cached: JsonSchemaObject | undefined;

/**
 * The MotionDoc as JSON Schema. The result is a fresh copy every call, so a caller may adjust it
 * (dropping `$schema`, for instance) without changing it for the next caller.
 */
export function motionDocJsonSchema(): JsonSchemaObject {
  if (!cached) cached = build();
  return copy(cached);
}
