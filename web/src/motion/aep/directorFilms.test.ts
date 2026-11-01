import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseMotionDoc, type Layer } from '@engine/schema';
import { bakeDoc, qaDoc } from '@engine/qa';
import { aepToMotion } from './index';

// The director films (fixtures/r8, written by `npm run r8:fixtures`) must convert without losing a feature:
// no warning, a valid MotionDoc, a clean qaDoc, and the same count of effects, polystars, blends, rotations
// and text layers on both sides. A silent drop is the bug this guard exists to catch.

const DIR = path.resolve('fixtures/r8');
const files = readdirSync(DIR).filter((f) => f.endsWith('.json') && f !== 'layout.json');

/** Warnings a film may still convert with: none today. A new entry needs a reason and a story. */
const ALLOWED_WARNINGS: RegExp[] = [];

interface AepLayer { kind: string; blendMode?: string; effects?: unknown[]; path?: { kind?: string }; transform?: { rotation?: unknown }; precompId?: string; id: string }
interface AepComp { layers: AepLayer[]; precomps?: Record<string, { layers: AepLayer[] }> }

function aepLayers(comp: AepComp): AepLayer[] {
  const out = [...comp.layers];
  for (const p of Object.values(comp.precomps ?? {})) out.push(...p.layers);
  return out;
}

function flatten(layers: readonly Layer[], out: Layer[] = []): Layer[] {
  for (const l of layers) {
    out.push(l);
    if (l.type === 'group') flatten(l.children, out);
  }
  return out;
}

const isRotated = (r: unknown): boolean => (Array.isArray(r) ? r.some((k: { v: number }) => k.v !== 0) : typeof r === 'number' && r !== 0);

describe('director films on the Three engine', () => {
  it('has the nine films', () => {
    expect(files).toHaveLength(9);
  });

  it('covers the features the guard counts (so a zero-equals-zero pass cannot hide a gap)', () => {
    const all = files.flatMap((f) => aepLayers(JSON.parse(readFileSync(path.join(DIR, f), 'utf8')) as AepComp));
    expect(all.some((l) => (l.effects?.length ?? 0) > 0), 'an effect').toBe(true);
    expect(all.some((l) => l.kind === 'shape' && l.path?.kind === 'polystar'), 'a polystar').toBe(true);
    expect(all.some((l) => l.kind === 'text'), 'text').toBe(true);
    expect(all.some((l) => isRotated(l.transform?.rotation)), 'a rotation').toBe(true);
  });

  for (const file of files) {
    describe(file, () => {
      const comp = JSON.parse(readFileSync(path.join(DIR, file), 'utf8')) as AepComp;
      const { doc, warnings } = aepToMotion(comp as never);

      it('converts with no unexpected warning', () => {
        const unexpected = warnings.filter((w) => !ALLOWED_WARNINGS.some((re) => re.test(w)));
        expect(unexpected).toEqual([]);
      });

      it('is a valid MotionDoc with a clean qaDoc', () => {
        const parsed = parseMotionDoc(doc);
        expect(parsed.ok, JSON.stringify(parsed.ok ? [] : parsed.errors)).toBe(true);
        if (!parsed.ok) return;
        const report = qaDoc(parsed.doc, bakeDoc(parsed.doc));
        expect(report.warnings.map((g) => `${g.kind} ${g.subject}`)).toEqual([]);
      });

      it('loses no feature: effects, polystars, blends, rotations and text are counted on both sides', () => {
        const parsed = parseMotionDoc(doc);
        if (!parsed.ok) throw new Error('invalid doc');
        const out = flatten(parsed.doc.layers);
        const src = aepLayers(comp);
        const count = <T,>(xs: T[], f: (x: T) => boolean) => xs.filter(f).length;
        const outFx = out.reduce((n, l) => n + (l.effects?.length ?? 0), 0);
        const srcFx = src.reduce((n, l) => n + (l.effects?.length ?? 0), 0);
        expect(outFx, 'effects').toBe(srcFx);
        expect(count(out, (l) => l.type === 'shape' && (l as { shape?: string }).shape === 'polystar'), 'polystars').toBe(
          count(src, (l) => l.kind === 'shape' && l.path?.kind === 'polystar'),
        );
        expect(count(out, (l) => l.blendMode !== 'normal'), 'non-normal blends').toBe(count(src, (l) => l.blendMode !== undefined && l.blendMode !== 'normal'));
        expect(count(out, (l) => l.type === 'text'), 'text layers').toBe(count(src, (l) => l.kind === 'text'));
        expect(count(out, (l) => isRotated(l.rotation) || (l.tweens ?? []).some((t) => 'rotation' in t.to)), 'rotated layers').toBeGreaterThanOrEqual(
          count(src, (l) => isRotated(l.transform?.rotation)),
        );
      });
    });
  }
});
