import { describe, expect, it } from 'vitest';
import { parseMotionDoc, type MotionDocInput } from '../schema';
import { qaLayout, type LayoutSpec } from './layout';

// A 1000x2000 portrait stage with a price badge: a ring (ellipse 400), a white face and the price text on top.
function parse(layers: unknown[]) {
  const result = parseMotionDoc({ version: 1, width: 1000, height: 2000, fps: 10, duration: 2, layers } as MotionDocInput);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.doc;
}
const shape = (id: string, shapeKind: 'rect' | 'ellipse', x: number, y: number, w: number, h: number, extra: Record<string, unknown> = {}) => ({ id, type: 'shape', shape: shapeKind, x, y, width: w, height: h, end: 2, ...extra });
const text = (id: string, x: number, y: number, size: number, extra: Record<string, unknown> = {}) => ({ id, type: 'text', text: '$3.50', x, y, end: 2, style: { fontSize: size }, ...extra });

const spec: LayoutSpec = {
  tiers: { plate: 'backdrop', pack: 'subject', ring: 'overlay', price: 'text' },
  contains: [{ container: 'ring', content: 'price' }],
};
const base = () => [shape('plate', 'rect', 500, 1000, 1000, 2000), shape('pack', 'rect', 500, 1000, 200, 600), shape('ring', 'ellipse', 800, 600, 400, 400)];

describe('qaLayout', () => {
  it('passes a price inside its ring, drawn after it and after the pack', () => {
    const r = qaLayout(parse([...base(), text('price', 800, 600, 60)]), spec);
    expect(r).toMatchObject({ ok: true, groups: [] });
  });

  it('flags the price drawn before its ring: the ring hides the numbers', () => {
    const r = qaLayout(parse([shape('plate', 'rect', 500, 1000, 1000, 2000), text('price', 800, 600, 60), shape('ring', 'ellipse', 800, 600, 400, 400)]), spec);
    const kinds = r.groups.map((g) => g.kind);
    expect(kinds).toContain('LAYER_ORDER');
    expect(r.groups.find((g) => g.kind === 'LAYER_ORDER')!.cause).toMatch(/drawn before its container|is drawn after/);
  });

  it('flags a tier drawn behind a lower one it overlaps: the plate drawn over the pack', () => {
    const r = qaLayout(parse([shape('pack', 'rect', 500, 1000, 200, 600), shape('plate', 'rect', 500, 1000, 1000, 2000), shape('ring', 'ellipse', 800, 600, 400, 400), text('price', 800, 600, 60)]), spec);
    const g = r.groups.find((x) => x.kind === 'LAYER_ORDER')!;
    expect(g.subject).toBe('pack+plate');
    expect(g.hint).toMatch(/draw "pack" after "plate"/);
  });

  it('flags numbers wider than the ring, using the ellipse and not its box corners', () => {
    // a 400 px ring; a text 380 px wide sits inside the box but its corners are outside the circle
    const wide = text('price', 800, 600, 220);
    const r = qaLayout(parse([...base(), wide]), spec);
    expect(r.groups.map((g) => g.kind)).toContain('NOT_CONTAINED');
  });

  it('catches a pop: the ring stays still while the text scales up past it on later frames', () => {
    const popping = text('price', 800, 600, 100, { tweens: [{ at: 1, duration: 0.5, to: { scale: 3 } }] });
    const r = qaLayout(parse([...base(), popping]), spec);
    const g = r.groups.find((x) => x.kind === 'NOT_CONTAINED')!;
    expect(g).toBeTruthy();
    expect(g.first).toBeGreaterThanOrEqual(10);
  });

  it('skips layers that are not listed and layers that are not visible', () => {
    const r = qaLayout(parse([shape('grade', 'rect', 500, 1000, 1000, 2000), ...base(), text('price', 800, 600, 60, { alpha: 0 })]), spec);
    expect(r.ok).toBe(true);
  });
});
