import { describe, expect, it } from 'vitest';
import { parseMotionDoc, type MotionDocInput } from '../schema';
import { busyUnder, calmQuadrants, PLATE_GRID, qaPlacement, quadrantOf, type PlateMap } from './placement';

// A 1000x2000 portrait stage. The "plate" is a full-stage rect; its table runs from 60% to 85% down it.
function parse(layers: unknown[]) {
  const result = parseMotionDoc({ version: 1, width: 1000, height: 2000, fps: 10, duration: 2, layers } as MotionDocInput);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.doc;
}

const rect = (id: string, x: number, y: number, w: number, h: number, extra: Record<string, unknown> = {}) => ({
  id,
  type: 'shape',
  shape: 'rect',
  x,
  y,
  width: w,
  height: h,
  end: 2,
  ...extra,
});
const plate = (extra: Record<string, unknown> = {}) => rect('plate', 500, 1000, 1000, 2000, extra);
/** A 200x600 pack whose base sits at `base`. */
const pack = (base: number) => rect('pack', 500, base - 300, 200, 600);
const text = (id: string, x: number, y: number, extra: Record<string, unknown> = {}) => ({
  id,
  type: 'text',
  text: 'Cold Brew',
  x,
  y,
  end: 2,
  style: { fontSize: 60 },
  ...extra,
});

/** Calm everywhere except the top-left quadrant. */
function map(): PlateMap {
  const busy = Array.from({ length: PLATE_GRID * PLATE_GRID }, (_, i) => (Math.floor(i / PLATE_GRID) < 6 && i % PLATE_GRID < 6 ? 0.9 : 0.05));
  return { busy, surfaces: [{ name: 'table', top: 0.6, bottom: 0.85, left: 0, right: 1 }], source: 'vision' };
}

describe('qaPlacement', () => {
  it('passes a pack that stands on the table', () => {
    const r = qaPlacement(parse([plate(), pack(1400)]), { plate: 'plate', map: map(), grounded: ['pack'] });
    expect(r).toMatchObject({ ok: true, groups: [], warnings: [], moves: [] });
  });

  it('flags a pack that floats above the back edge and gives the move to the middle of the table', () => {
    const r = qaPlacement(parse([plate(), pack(1000)]), { plate: 'plate', map: map(), grounded: ['pack'] });
    expect(r.groups.map((g) => g.kind)).toEqual(['NOT_GROUNDED']);
    expect(r.groups[0].worst).toBe(200);
    // table middle is 0.725 x 2000 = 1450; the base is at 1000
    expect(r.moves).toEqual([{ subject: 'pack', dy: 450 }]);
  });

  it('reads the table through the plate box, so a plate that drifts away leaves the pack floating on the late frames only', () => {
    const drifting = plate({ tweens: [{ at: 1, duration: 0.5, to: { y: 1600 } }] });
    const r = qaPlacement(parse([drifting, pack(1300)]), { plate: 'plate', map: map(), grounded: ['pack'] });
    const g = r.groups.find((x) => x.kind === 'NOT_GROUNDED');
    expect(g).toBeDefined();
    expect(g!.first).toBeGreaterThan(9);
  });

  it('flags text that lies on the pack', () => {
    const r = qaPlacement(parse([plate(), pack(1400), text('price', 500, 1100)]), { plate: 'plate', map: map(), grounded: ['pack'] });
    expect(r.groups.map((g) => `${g.kind} ${g.subject}`)).toEqual(['COVERS_SUBJECT price+pack']);
    expect(r.groups[0].hint).toMatch(/Q[1-4]/);
  });

  it('warns about text on a busy patch, but not when a shape backs it', () => {
    const bare = qaPlacement(parse([plate(), pack(1400), text('t', 250, 300)]), { plate: 'plate', map: map(), grounded: ['pack'] });
    expect(bare.warnings.map((g) => `${g.kind} ${g.subject}`)).toEqual(['TEXT_ON_BUSY t']);
    const backed = qaPlacement(parse([plate(), pack(1400), rect('chip', 250, 300, 500, 200), text('t', 250, 300)]), {
      plate: 'plate',
      map: map(),
      grounded: ['pack'],
    });
    expect(backed.warnings).toEqual([]);
  });

  it('flags a missing plate layer', () => {
    const r = qaPlacement(parse([pack(1400)]), { plate: 'plate', map: map(), grounded: ['pack'] });
    expect(r.ok).toBe(false);
  });
});

describe('plate map helpers', () => {
  it('names quadrants as on a Cartesian plane', () => {
    expect([quadrantOf(900, 100, 1000, 2000), quadrantOf(100, 100, 1000, 2000), quadrantOf(100, 1900, 1000, 2000), quadrantOf(900, 1900, 1000, 2000)]).toEqual(['Q1', 'Q2', 'Q3', 'Q4']);
  });

  it('ranks the busy quadrant last and weights busy by covered area', () => {
    expect(calmQuadrants(map()).at(-1)).toBe('Q2');
    expect(busyUnder(map(), 0, 0, 0.5, 0.5)).toBeCloseTo(0.9);
    expect(busyUnder(map(), 0.25, 0, 0.75, 0.5)).toBeCloseTo((0.9 + 0.05) / 2);
  });
});
