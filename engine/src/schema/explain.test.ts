import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { explainDoc } from './explain';

const base = () =>
  JSON.parse(readFileSync(join(process.cwd(), 'engine/fixtures/basic-2d.json'), 'utf8')) as {
    layers: Record<string, unknown>[];
  };

describe('explainDoc', () => {
  it('valid fixture is ok', () => {
    const r = explainDoc(base());
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('never throws on junk', () => {
    for (const v of [null, 'x', [], 5, undefined]) expect(explainDoc(v).ok).toBe(false);
  });

  it('unknown preset', () => {
    const doc = base();
    doc.layers[0].enter = { name: 'slideUp' };
    const e = explainDoc(doc).errors.find((x) => x.code === 'UNKNOWN_PRESET');
    expect(e?.hint).toContain('slideInUp');
  });

  it('unknown property', () => {
    const doc = base();
    doc.layers[0].tweens = [{ at: 0, duration: 1, to: { rotaton: 90 } }];
    const e = explainDoc(doc).errors.find((x) => x.code === 'UNKNOWN_PROPERTY');
    expect(e?.hint).toContain('rotation');
  });

  it('time overflow', () => {
    const doc = base();
    doc.layers[0].start = 0;
    doc.layers[0].end = 2;
    doc.layers[0].tweens = [{ at: 1.5, duration: 1, to: { x: 5 } }];
    const e = explainDoc(doc).errors.find((x) => x.code === 'TIME_OVERFLOW');
    expect(e?.hint).toContain('Latest allowed at is 1s');
    expect(e?.hint).toContain('duration');
  });
});
