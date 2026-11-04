import type { ZodIssue } from 'zod';
import { PRESET_NAME_VALUES } from './enums';
import { MotionDocSchema, formatErrorPath } from './doc';
import type { MotionDoc } from './doc';

export type ExplainCode =
  | 'UNKNOWN_PRESET'
  | 'UNKNOWN_PROPERTY'
  | 'TIME_OVERFLOW'
  | 'UNKNOWN_KEY'
  | 'UNKNOWN_ENUM'
  | 'MISSING_FIELD'
  | 'WRONG_TYPE'
  | 'UNKNOWN_REFERENCE'
  | 'INVALID_DOC';

export interface ExplainError {
  code: ExplainCode;
  path: string;
  message: string;
  hint: string;
}

export type ExplainResult = { ok: true; doc: MotionDoc; errors: [] } | { ok: false; errors: ExplainError[] };

const LAYER_PROPS = ['x', 'y', 'alpha', 'rotation', 'scale', 'scaleX', 'scaleY'];
const LAYER_EXTRA: Record<string, string[]> = { image: ['tint'], text: ['fill'], shape: ['fill'] };
const CAMERA_PROPS = ['position.x', 'position.y', 'position.z', 'lookAt.x', 'lookAt.y', 'lookAt.z', 'fov'];
const OBJECT_PROPS = [
  'position.x', 'position.y', 'position.z', 'rotation.x', 'rotation.y', 'rotation.z', 'scale', 'scale.x', 'scale.y', 'scale.z',
  'material.color', 'material.emissive', 'material.emissiveIntensity', 'material.roughness', 'material.metalness', 'material.opacity',
];
const LIGHT_PROPS = ['intensity', 'color', 'position.x', 'position.y', 'position.z', 'target.x', 'target.y', 'target.z', 'angle'];

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

/** The closest candidate to `value`, or null when nothing is near. */
export function closest(value: string, candidates: readonly string[]): string | null {
  const lower = value.toLowerCase();
  let best: string | null = null;
  let bestScore = Infinity;
  for (const candidate of candidates) {
    const score = distance(lower, candidate.toLowerCase());
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best !== null && bestScore <= Math.max(2, Math.floor(value.length / 3)) ? best : null;
}

function suggest(value: string, candidates: readonly string[], noun: string): string {
  const near = closest(value, candidates);
  const list = candidates.length > 12 ? `${candidates.slice(0, 12).join(', ')}, ...` : candidates.join(', ');
  return near ? `Did you mean "${near}"? Valid ${noun}: ${list}` : `Valid ${noun}: ${list}`;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function at(input: unknown, path: (string | number)[]): unknown {
  let cur: unknown = input;
  for (const key of path) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string | number, unknown>)[key];
  }
  return cur;
}

function mapIssue(issue: ZodIssue, input: unknown): ExplainError {
  const path = formatErrorPath(issue.path as (string | number)[]);
  const last = issue.path[issue.path.length - 1];
  const message = issue.message;
  const make = (code: ExplainCode, hint: string): ExplainError => ({ code, path, message, hint });

  if (issue.code === 'invalid_enum_value') {
    const options = issue.options.map(String);
    if (last === 'name' && options.every((o) => (PRESET_NAME_VALUES as readonly string[]).includes(o))) {
      return make('UNKNOWN_PRESET', suggest(String(issue.received), PRESET_NAME_VALUES, 'presets'));
    }
    return make('UNKNOWN_ENUM', suggest(String(issue.received), options, 'values'));
  }
  if (issue.code === 'unrecognized_keys') {
    const keys = issue.keys;
    const parent = at(input, issue.path as (string | number)[]);
    const known = isRecord(parent) ? Object.keys(parent) : [];
    return make('UNKNOWN_KEY', `Remove or rename ${keys.map((k) => `"${k}"`).join(', ')}. ${keys.map((k) => closest(k, known) ?? '').filter(Boolean).length ? 'Check spelling against the sibling keys.' : 'See the doc schema for allowed keys.'}`);
  }
  if (issue.code === 'invalid_type') {
    if (issue.received === 'undefined') return make('MISSING_FIELD', `Add the required field "${String(last)}" (expected ${issue.expected}).`);
    return make('WRONG_TYPE', `Expected ${issue.expected} but got ${issue.received}.`);
  }
  const overflow = /^tween ends at ([\d.eE+-]+)s but the layer is ([\d.eE+-]+)s long$/.exec(message);
  if (overflow) {
    const length = Number(overflow[2]);
    const tween = at(input, issue.path as (string | number)[]);
    const t = isRecord(tween) ? tween : {};
    const duration = typeof t.duration === 'number' ? t.duration : 0;
    const repeat = typeof t.repeat === 'number' ? t.repeat : 0;
    const total = duration * (repeat + 1);
    const latest = Math.max(0, +(length - total).toFixed(4));
    const maxDuration = +(length - (typeof t.at === 'number' ? t.at : 0)).toFixed(4) / (repeat + 1);
    return make(
      'TIME_OVERFLOW',
      `Latest allowed at is ${latest}s for this duration; or shorten duration to at most ${+maxDuration.toFixed(4)}s; or extend the layer end (layer is ${length}s long).`,
    );
  }
  if (/is after the .*s doc duration|after the group's length|exceed the .*s layer|is after the layer's|must be greater than start/.test(message)) {
    return make('TIME_OVERFLOW', 'Shorten the timing or lengthen the layer / doc duration so everything fits.');
  }
  if (/^unknown asset|asset ".*" is a /.test(message) || /must name (an )?object/.test(message)) {
    return make('UNKNOWN_REFERENCE', 'Reference an id that exists: declare it in assets / objects, or fix the spelling.');
  }
  return make('INVALID_DOC', 'Fix the value at this path to match the schema.');
}

/** Tween property names the schema accepts only as strings; check them against what each target exposes. */
function checkTweenProps(input: unknown): ExplainError[] {
  const errors: ExplainError[] = [];
  const walk = (layers: unknown, base: (string | number)[]): void => {
    if (!Array.isArray(layers)) return;
    layers.forEach((layer, index) => {
      if (!isRecord(layer)) return;
      const path = [...base, index];
      if (Array.isArray(layer.tweens)) {
        layer.tweens.forEach((tween, ti) => {
          if (!isRecord(tween)) return;
          const target = typeof tween.target === 'string' ? tween.target : undefined;
          let allowed: string[] | null;
          if (target === undefined) allowed = [...LAYER_PROPS, ...(LAYER_EXTRA[String(layer.type)] ?? [])];
          else if (target === 'camera') allowed = CAMERA_PROPS;
          else if (target.startsWith('object:')) allowed = OBJECT_PROPS;
          else if (target.startsWith('light:')) allowed = LIGHT_PROPS;
          else allowed = null;
          if (!allowed) return;
          for (const mapKey of ['to', 'from'] as const) {
            const map = tween[mapKey];
            if (!isRecord(map)) continue;
            for (const prop of Object.keys(map)) {
              if (allowed.includes(prop)) continue;
              const p = [...path, 'tweens', ti, mapKey, prop];
              errors.push({
                code: 'UNKNOWN_PROPERTY',
                path: formatErrorPath(p),
                message: `unknown property "${prop}" on ${target ?? 'layer'}`,
                hint: suggest(prop, allowed, `properties for ${target ?? `${String(layer.type)} layer`}`),
              });
            }
          }
        });
      }
      walk(layer.children, [...path, 'children']);
    });
  };
  if (isRecord(input)) walk(input.layers, ['layers']);
  return errors;
}

/** Validate any input and explain each problem with a code and a fix hint. Never throws. */
export function explainDoc(input: unknown): ExplainResult {
  try {
    const result = MotionDocSchema.safeParse(input);
    const errors: ExplainError[] = result.success ? [] : result.error.issues.map((issue) => mapIssue(issue, input));
    errors.push(...checkTweenProps(input));
    if (errors.length === 0 && result.success) return { ok: true, doc: result.data, errors: [] };
    if (errors.length === 0) errors.push({ code: 'INVALID_DOC', path: '', message: 'invalid doc', hint: 'Pass a doc object.' });
    return { ok: false, errors };
  } catch (error) {
    return { ok: false, errors: [{ code: 'INVALID_DOC', path: '', message: error instanceof Error ? error.message : String(error), hint: 'Pass a doc object.' }] };
  }
}
