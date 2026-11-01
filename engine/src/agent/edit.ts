import { explainDoc } from '../schema/explain';
import type { ExplainError } from '../schema/explain';
import { qaDoc } from '../qa/qa';

export type EditableDoc = Record<string, unknown>;
export type LayerInput = Record<string, unknown>;
export type TweenInput = Record<string, unknown>;

export type EditOp =
  | { op: 'set'; path: string; value: unknown }
  | { op: 'unset'; path: string }
  | { op: 'addLayer'; layer: LayerInput; index?: number }
  | { op: 'removeLayer'; id: string }
  | { op: 'addTween'; layerId: string; tween: TweenInput; index?: number }
  | { op: 'removeTween'; layerId: string; index: number }
  | { op: 'setEffectParam'; layerId: string | null; effectId: string; param: string; value: number | string };

export interface Receipt {
  id: string;
  revisionBefore: number;
  revisionAfter: number;
  affected: string[];
  warnings: string[];
  qa?: { ok: boolean; groups: number };
  inverse: EditOp[];
}

export interface EditError {
  code: 'STALE_DOC' | 'INVALID' | 'NOT_FOUND';
  message: string;
  recovery: string;
  details?: unknown;
}

export type EditResult = { ok: true; doc: EditableDoc; receipt: Receipt } | { ok: false; error: EditError };

class OpError extends Error {
  constructor(
    readonly code: 'NOT_FOUND' | 'INVALID',
    message: string,
  ) {
    super(message);
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const clone = <T>(value: T): T => structuredClone(value);
const revisionOf = (doc: EditableDoc): number => (typeof doc.revision === 'number' ? doc.revision : 0);

/** Short stable FNV-1a hash (8 hex chars). */
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Step into `container` by key: array elements match by `id` first, then numeric index. */
function child(container: unknown, key: string): { value: unknown; key: string | number } | null {
  if (Array.isArray(container)) {
    const byId = container.findIndex((item) => isRecord(item) && item.id === key);
    if (byId >= 0) return { value: container[byId], key: byId };
    if (/^\d+$/.test(key) && Number(key) < container.length) return { value: container[Number(key)], key: Number(key) };
    return null;
  }
  if (isRecord(container) && Object.prototype.hasOwnProperty.call(container, key)) return { value: container[key], key };
  return null;
}

function resolveParent(doc: EditableDoc, path: string): { parent: unknown; key: string | number | null; last: string } {
  const segments = path.split('/').filter((segment) => segment !== '');
  if (segments.length === 0) throw new OpError('INVALID', 'empty path');
  let cur: unknown = doc;
  for (const segment of segments.slice(0, -1)) {
    let next = child(cur, segment);
    if (!next && Array.isArray(cur)) {
      const nested = findLayer(cur, segment);
      if (nested) next = { value: nested, key: -1 };
    }
    if (!next) throw new OpError('NOT_FOUND', `path "${path}": "${segment}" not found`);
    cur = next.value;
  }
  const last = segments[segments.length - 1];
  const hit = child(cur, last);
  return { parent: cur, key: hit ? hit.key : null, last };
}

function findLayer(layers: unknown, id: string): Record<string, unknown> | null {
  if (!Array.isArray(layers)) return null;
  for (const layer of layers) {
    if (!isRecord(layer)) continue;
    if (layer.id === id) return layer;
    const nested = findLayer(layer.children, id);
    if (nested) return nested;
  }
  return null;
}

function needLayer(doc: EditableDoc, id: string): Record<string, unknown> {
  const layer = findLayer(doc.layers, id);
  if (!layer) throw new OpError('NOT_FOUND', `layer "${id}" not found`);
  return layer;
}

/** Apply one op in place; returns its inverse and the layer ids it touched. */
function applyOne(doc: EditableDoc, op: EditOp): { inverse: EditOp[]; affected: string[] } {
  switch (op.op) {
    case 'set':
    case 'unset': {
      const { parent, key, last } = resolveParent(doc, op.path);
      const segments = op.path.split('/').filter((s) => s !== '');
      const affected = segments[0] === 'layers' && segments[1] ? [segments[1]] : [];
      if (segments[0] === 'revision') throw new OpError('INVALID', 'revision is managed by applyEdit');
      const existed = key !== null;
      const previous = existed ? clone((Array.isArray(parent) ? parent[key as number] : (parent as Record<string, unknown>)[key as string])) : undefined;
      if (op.op === 'unset') {
        if (!existed) throw new OpError('NOT_FOUND', `path "${op.path}" not found`);
        if (Array.isArray(parent)) throw new OpError('INVALID', 'unset on an array element is not reversible; use removeTween / removeLayer');
        delete (parent as Record<string, unknown>)[key as string];
      } else if (Array.isArray(parent)) {
        if (!existed) throw new OpError('NOT_FOUND', `path "${op.path}" not found`);
        parent[key as number] = clone(op.value);
      } else if (isRecord(parent)) {
        parent[last] = clone(op.value);
      } else {
        throw new OpError('NOT_FOUND', `path "${op.path}" has no container`);
      }
      if (op.op === 'unset') return { inverse: [{ op: 'set', path: op.path, value: previous }], affected };
      return { inverse: [existed ? { op: 'set', path: op.path, value: previous } : { op: 'unset', path: op.path }], affected };
    }
    case 'addLayer': {
      const layers = doc.layers;
      if (!Array.isArray(layers)) throw new OpError('INVALID', 'doc has no layers array');
      const id = op.layer.id;
      if (typeof id !== 'string') throw new OpError('INVALID', 'layer needs a string id');
      const index = op.index === undefined ? layers.length : Math.max(0, Math.min(op.index, layers.length));
      layers.splice(index, 0, clone(op.layer));
      return { inverse: [{ op: 'removeLayer', id }], affected: [id] };
    }
    case 'removeLayer': {
      const layers = doc.layers;
      const index = Array.isArray(layers) ? layers.findIndex((l) => isRecord(l) && l.id === op.id) : -1;
      if (index < 0) throw new OpError('NOT_FOUND', `layer "${op.id}" not found at the top level`);
      const [removed] = (layers as unknown[]).splice(index, 1);
      return { inverse: [{ op: 'addLayer', layer: removed as LayerInput, index }], affected: [op.id] };
    }
    case 'addTween': {
      const layer = needLayer(doc, op.layerId);
      const created = !Array.isArray(layer.tweens);
      if (created) layer.tweens = [];
      const tweens = layer.tweens as unknown[];
      const index = op.index === undefined ? tweens.length : Math.max(0, Math.min(op.index, tweens.length));
      tweens.splice(index, 0, clone(op.tween));
      const undo: EditOp[] = [{ op: 'removeTween', layerId: op.layerId, index }];
      if (created) undo.push({ op: 'unset', path: `layers/${op.layerId}/tweens` });
      return { inverse: undo, affected: [op.layerId] };
    }
    case 'removeTween': {
      const layer = needLayer(doc, op.layerId);
      const tweens = Array.isArray(layer.tweens) ? (layer.tweens as unknown[]) : [];
      if (!Number.isInteger(op.index) || op.index < 0 || op.index >= tweens.length) {
        throw new OpError('NOT_FOUND', `layer "${op.layerId}" has no tween at index ${op.index}`);
      }
      const [removed] = tweens.splice(op.index, 1);
      return { inverse: [{ op: 'addTween', layerId: op.layerId, tween: removed as TweenInput, index: op.index }], affected: [op.layerId] };
    }
    case 'setEffectParam': {
      const owner = op.layerId === null ? doc : needLayer(doc, op.layerId);
      const list = Array.isArray(owner.effects) ? (owner.effects as unknown[]) : [];
      const effect = list.find((e) => isRecord(e) && e.id === op.effectId);
      if (!isRecord(effect)) throw new OpError('NOT_FOUND', `effect "${op.effectId}" not found`);
      const prefix = op.layerId === null ? 'effects' : `layers/${op.layerId}/effects`;
      const path = `${prefix}/${op.effectId}/params/${op.param}`;
      const params = isRecord(effect.params) ? effect.params : (effect.params = {});
      const had = Object.prototype.hasOwnProperty.call(params, op.param);
      const previous = (params as Record<string, unknown>)[op.param];
      (params as Record<string, unknown>)[op.param] = op.value;
      return {
        inverse: [had ? { op: 'setEffectParam', layerId: op.layerId, effectId: op.effectId, param: op.param, value: previous as number | string } : { op: 'unset', path }],
        affected: op.layerId === null ? [] : [op.layerId],
      };
    }
    default:
      throw new OpError('INVALID', `unknown op "${String((op as { op?: unknown }).op)}"`);
  }
}

function run(doc: EditableDoc, ops: EditOp[], expectRevision: number): EditResult {
  const before = revisionOf(doc);
  if (!isRecord(doc)) {
    return { ok: false, error: { code: 'INVALID', message: 'doc must be an object', recovery: 'pass a motion doc object' } };
  }
  if (expectRevision !== before) {
    return {
      ok: false,
      error: {
        code: 'STALE_DOC',
        message: `doc is at revision ${before}, expected ${expectRevision}`,
        recovery: 're-read the doc and re-apply',
        details: { revision: before, expectRevision },
      },
    };
  }
  const working = clone(doc);
  const inverse: EditOp[] = [];
  const affected: string[] = [];
  try {
    for (const op of ops) {
      const step = applyOne(working, op);
      inverse.unshift(...step.inverse);
      for (const id of step.affected) if (!affected.includes(id)) affected.push(id);
    }
  } catch (error) {
    if (error instanceof OpError) {
      return {
        ok: false,
        error: {
          code: error.code,
          message: error.message,
          recovery: error.code === 'NOT_FOUND' ? 're-read the doc and use ids / indexes that exist' : 'fix the op and retry',
        },
      };
    }
    throw error;
  }
  working.revision = before + 1;
  const explained = explainDoc(working);
  if (!explained.ok) {
    const errors: ExplainError[] = explained.errors;
    return {
      ok: false,
      error: {
        code: 'INVALID',
        message: errors[0] ? `${errors[0].path}: ${errors[0].message}` : 'edit produced an invalid doc',
        recovery: 'fix the errors listed in details and retry; the doc is unchanged',
        details: errors,
      },
    };
  }
  const receipt: Receipt = {
    id: hash(`${before}:${JSON.stringify(ops)}`),
    revisionBefore: before,
    revisionAfter: before + 1,
    affected,
    warnings: [],
    inverse,
  };
  try {
    const report = qaDoc(explained.doc);
    receipt.qa = { ok: report.ok, groups: report.groups.length };
    receipt.warnings = report.warnings.map((w) => `${w.kind} ${w.subject}: ${w.hint}`);
  } catch {
    // QA is advisory; a bake failure must not block an otherwise valid edit.
  }
  return { ok: true, doc: working, receipt };
}

/** Apply `ops` atomically. Refuses when `expectRevision` is not the doc's revision. Never mutates `doc`. */
export function applyEdit(doc: EditableDoc, ops: EditOp[], opts: { expectRevision: number }): EditResult {
  return run(doc, ops, opts.expectRevision);
}

/** Apply a receipt's inverse ops, restoring the doc it came from (revision still increases). */
export function undoEdit(doc: EditableDoc, receipt: Receipt, opts: { expectRevision: number }): EditResult {
  return run(doc, receipt.inverse, opts.expectRevision);
}
