import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyEdit, undoEdit } from './edit';
import type { EditOp, EditableDoc } from './edit';

const load = (): EditableDoc => JSON.parse(readFileSync(join(process.cwd(), 'engine/fixtures/basic-2d.json'), 'utf8')) as EditableDoc;
const strip = (doc: EditableDoc): EditableDoc => {
  const { revision: _revision, ...rest } = doc;
  return rest;
};

function ok(result: ReturnType<typeof applyEdit>) {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result;
}

describe('applyEdit', () => {
  it('bumps the revision and refuses a stale one', () => {
    const doc = load();
    const copy = structuredClone(doc);
    const good = ok(applyEdit(doc, [{ op: 'set', path: 'layers/title/x', value: 100 }], { expectRevision: 0 }));
    expect(good.receipt.revisionAfter).toBe(1);
    expect(good.doc.revision).toBe(1);
    const stale = applyEdit(doc, [{ op: 'set', path: 'layers/title/x', value: 100 }], { expectRevision: 5 });
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.error.code).toBe('STALE_DOC');
    expect(doc).toEqual(copy);
  });

  const cases: Array<[string, EditOp[]]> = [
    ['set existing', [{ op: 'set', path: 'layers/title/x', value: 123 }]],
    ['set new key', [{ op: 'set', path: 'layers/bg/alpha', value: 0.5 }]],
    ['unset', [{ op: 'unset', path: 'layers/title/exit' }]],
    ['addLayer', [{ op: 'addLayer', index: 1, layer: { id: 'extra', type: 'shape', shape: 'rect', width: 20, height: 20, fill: '#ffffff', x: 5, y: 5 } }]],
    ['removeLayer', [{ op: 'removeLayer', id: 'badge' }]],
    ['addTween', [{ op: 'addTween', layerId: 'title', tween: { at: 1, duration: 1, to: { x: 50 } } }]],
    ['removeTween', [
      { op: 'addTween', layerId: 'title', tween: { at: 1, duration: 1, to: { x: 50 } } },
    ]],
  ];
  for (const [name, ops] of cases) {
    it(`inverse restores the doc: ${name}`, () => {
      const original = load();
      const applied = ok(applyEdit(original, ops, { expectRevision: 0 }));
      const undone = ok(undoEdit(applied.doc, applied.receipt, { expectRevision: 1 }));
      expect(strip(undone.doc)).toEqual(strip(original));
      expect(undone.doc.revision).toBe(2);
    });
  }

  it('inverse restores removeTween and setEffectParam (layer and stage)', () => {
    const original = load();
    const withTween = ok(applyEdit(original, [{ op: 'addTween', layerId: 'title', tween: { at: 1, duration: 1, to: { x: 50 } } }], { expectRevision: 0 }));
    const removed = ok(applyEdit(withTween.doc, [{ op: 'removeTween', layerId: 'title', index: 0 }], { expectRevision: 1 }));
    expect(removed.receipt.inverse[0]).toMatchObject({ op: 'addTween', index: 0 });
    expect(strip(ok(undoEdit(removed.doc, removed.receipt, { expectRevision: 2 })).doc)).toEqual(strip(withTween.doc));

    const fx = { ...load(), effects: [{ id: 'blur1', type: 'blur', params: { strength: 2 } }] };
    const set = ok(applyEdit(fx, [{ op: 'setEffectParam', layerId: null, effectId: 'blur1', param: 'strength', value: 6 }], { expectRevision: 0 }));
    expect(strip(ok(undoEdit(set.doc, set.receipt, { expectRevision: 1 })).doc)).toEqual(strip(fx));
    const fresh = ok(applyEdit(fx, [{ op: 'setEffectParam', layerId: null, effectId: 'blur1', param: 'quality', value: 3 }], { expectRevision: 0 }));
    expect(strip(ok(undoEdit(fresh.doc, fresh.receipt, { expectRevision: 1 })).doc)).toEqual(strip(fx));
  });

  it('gives identical receipt ids for identical calls', () => {
    const ops: EditOp[] = [{ op: 'set', path: 'layers/title/x', value: 7 }];
    const a = ok(applyEdit(load(), ops, { expectRevision: 0 }));
    const b = ok(applyEdit(load(), ops, { expectRevision: 0 }));
    expect(a.receipt.id).toBe(b.receipt.id);
    expect(a.receipt.affected).toEqual(['title']);
  });

  it('is atomic: invalid second op changes nothing', () => {
    const doc = load();
    const copy = structuredClone(doc);
    const result = applyEdit(
      doc,
      [
        { op: 'set', path: 'layers/title/x', value: 9 },
        { op: 'set', path: 'layers/title/x', value: 'nope' },
      ],
      { expectRevision: 0 },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID');
      expect((result.error.details as unknown[]).length).toBeGreaterThan(0);
    }
    expect(doc).toEqual(copy);
  });

  it('reports NOT_FOUND for unknown layer, tween and effect', () => {
    const doc = load();
    for (const op of [
      { op: 'removeLayer', id: 'ghost' },
      { op: 'addTween', layerId: 'ghost', tween: {} },
      { op: 'removeTween', layerId: 'title', index: 9 },
      { op: 'setEffectParam', layerId: null, effectId: 'ghost', param: 'a', value: 1 },
    ] as EditOp[]) {
      const result = applyEdit(doc, [op], { expectRevision: 0 });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('NOT_FOUND');
    }
  });
});
