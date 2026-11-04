import type { Layer, MotionDoc } from '../schema';
import { bakeDoc, type BakedDoc, type BakedLayer, type Bounds } from './bake';
import type { QaGroup } from './qa';

// qaPlacement: does each thing sit where it belongs on the plate, on every frame? It reads only JSON — the
// baked boxes of the doc and a plate map (where the plate's surfaces are and how busy each cell is) — so it
// needs no render. The plate drifts, turns and is overscanned over a clip, so a plate fraction is mapped to
// the doc through the plate layer's box on that frame: the table line moves with the plate.
//
// Kinds: NOT_GROUNDED (a subject's base is off every surface), COVERS_SUBJECT (text over a subject),
// TEXT_ON_BUSY (warning: text on a busy patch of plate with nothing behind it).

/** The plate map is a GRID x GRID raster; 12 splits evenly into halves, thirds and quarters. */
export const PLATE_GRID = 12;

/** Quadrants as on a Cartesian plane with the origin at the frame centre: Q1 top-right, Q2 top-left, Q3 bottom-left, Q4 bottom-right. */
export type Quadrant = 'Q1' | 'Q2' | 'Q3' | 'Q4';
export const QUADRANTS: readonly Quadrant[] = ['Q1', 'Q2', 'Q3', 'Q4'];

/** Something a product can stand on, in fractions of the plate image (y down): top is its back edge, bottom its front edge. */
export interface PlateSurface {
  name: string;
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface PlateMap {
  /** Busy score 0 (flat) to 1 (busy) per cell, row-major from the top-left, PLATE_GRID x PLATE_GRID. */
  busy: number[];
  surfaces: PlateSurface[];
  /** What each quadrant holds, in a few words (from the vision read). */
  quadrants?: Partial<Record<Quadrant, string>>;
  /** 'vision': a model named the surfaces and code snapped them to measured edges. 'pixels': busy grid only, no surfaces (unread). */
  source: 'vision' | 'pixels';
}

export interface PlacementSpec {
  /** Id of the plate image layer. */
  plate: string;
  map: PlateMap;
  /** Layers whose base must rest on a surface (the product). Text must not cover them either. */
  grounded: string[];
}

export interface PlacementLimits {
  /** A layer counts as visible above this effective opacity. */
  visibleOpacity: number;
  /** Text counts as readable above this effective opacity. */
  readableOpacity: number;
  /** How far, as a share of stage height, a base may sit outside a surface band. */
  groundTolFrac: number;
  /** Share of a text box that may lie on a subject. */
  coverFrac: number;
  /** Mean busy score under a text box above which it is a warning. */
  busyLimit: number;
  /** A shape behind text counts as a backing above this opacity. */
  backingOpacity: number;
}

export const PLACEMENT_LIMITS: PlacementLimits = {
  visibleOpacity: 0.05,
  readableOpacity: 0.8,
  groundTolFrac: 0.005,
  coverFrac: 0.1,
  busyLimit: 0.45,
  backingOpacity: 0.3,
};

/** A move the fixer can apply: shift the subject's base by dy doc px (positive is down). */
export interface PlacementMove {
  subject: string;
  dy: number;
}

export interface PlacementReport {
  ok: boolean;
  groups: QaGroup[];
  warnings: QaGroup[];
  moves: PlacementMove[];
}

const r1 = (n: number): number => Math.round(n * 10) / 10;
const r3 = (n: number): number => Math.round(n * 1000) / 1000;

/** The quadrant a doc point falls in. */
export function quadrantOf(x: number, y: number, width: number, height: number): Quadrant {
  const right = x >= width / 2;
  const top = y < height / 2;
  return top ? (right ? 'Q1' : 'Q2') : right ? 'Q4' : 'Q3';
}

/** Mean busy score of a quadrant of the plate (its cells, in plate fractions). */
export function quadrantBusy(map: PlateMap, q: Quadrant): number {
  const half = PLATE_GRID / 2;
  const c0 = q === 'Q1' || q === 'Q4' ? half : 0;
  const r0 = q === 'Q1' || q === 'Q2' ? 0 : half;
  let sum = 0;
  for (let r = r0; r < r0 + half; r++) for (let c = c0; c < c0 + half; c++) sum += map.busy[r * PLATE_GRID + c] ?? 0;
  return sum / (half * half);
}

/** Quadrants from calmest to busiest. */
export function calmQuadrants(map: PlateMap): Quadrant[] {
  return [...QUADRANTS].sort((a, b) => quadrantBusy(map, a) - quadrantBusy(map, b));
}

/** Mean busy score under a plate-fraction box, weighted by how much of each cell it covers. */
export function busyUnder(map: PlateMap, fx0: number, fy0: number, fx1: number, fy1: number): number {
  const x0 = Math.max(0, fx0) * PLATE_GRID;
  const x1 = Math.min(1, fx1) * PLATE_GRID;
  const y0 = Math.max(0, fy0) * PLATE_GRID;
  const y1 = Math.min(1, fy1) * PLATE_GRID;
  if (x1 <= x0 || y1 <= y0) return 0;
  let sum = 0;
  let area = 0;
  for (let r = Math.floor(y0); r < Math.ceil(y1); r++) {
    for (let c = Math.floor(x0); c < Math.ceil(x1); c++) {
      const a = (Math.min(c + 1, x1) - Math.max(c, x0)) * (Math.min(r + 1, y1) - Math.max(r, y0));
      if (a <= 0) continue;
      sum += a * (map.busy[r * PLATE_GRID + c] ?? 0);
      area += a;
    }
  }
  return area > 0 ? sum / area : 0;
}

export function overlapArea(a: Bounds, b: Bounds): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

const contains = (outer: Bounds, inner: Bounds): boolean =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;

export function flatten(layers: readonly Layer[], out: Layer[] = []): Layer[] {
  for (const layer of layers) {
    out.push(layer);
    if (layer.type === 'group') flatten(layer.children, out);
  }
  return out;
}

export interface Hit {
  frame: number;
  value: number;
}

export function makeGroup(kind: QaGroup['kind'], subject: string, hits: Hit[], limit: number, cause: (w: Hit) => string, hint: (w: Hit) => string): QaGroup {
  const worst = hits.reduce((a, c) => (c.value > a.value ? c : a));
  return {
    kind,
    subject,
    count: hits.length,
    first: hits[0].frame,
    last: hits[hits.length - 1].frame,
    worst: r3(worst.value),
    worstFrame: worst.frame,
    limit: r3(limit),
    cause: cause(worst),
    hint: hint(worst),
  };
}

/** A surface band in doc space on one frame, read through the plate layer's box. */
function bandOf(s: PlateSurface, plate: Bounds): { top: number; bottom: number; left: number; right: number } {
  return {
    top: plate.y + s.top * plate.height,
    bottom: plate.y + s.bottom * plate.height,
    left: plate.x + s.left * plate.width,
    right: plate.x + s.right * plate.width,
  };
}

export function qaPlacement(doc: MotionDoc, spec: PlacementSpec, bake: BakedDoc = bakeDoc(doc), limits: Partial<PlacementLimits> = {}): PlacementReport {
  const lim: PlacementLimits = { ...PLACEMENT_LIMITS, ...limits };
  const byId = new Map(flatten(doc.layers).map((l) => [l.id, l] as const));
  const baked = new Map(bake.layers.map((l) => [l.id, l] as const));
  const plate = baked.get(spec.plate);
  const groups: QaGroup[] = [];
  const warnings: QaGroup[] = [];
  const moves: PlacementMove[] = [];
  if (!plate) {
    groups.push({
      kind: 'NOT_GROUNDED',
      subject: spec.plate,
      count: 0,
      first: 0,
      last: 0,
      worst: 0,
      worstFrame: 0,
      limit: 0,
      cause: `plate layer "${spec.plate}" is not in the doc`,
      hint: 'pass the id of the plate image layer',
    });
    return { ok: false, groups, warnings, moves };
  }
  const plateAt = (f: number): Bounds | null => plate.frames[f]?.bounds ?? null;
  const tol = lim.groundTolFrac * bake.height;

  // NOT_GROUNDED
  for (const id of spec.grounded) {
    const layer = baked.get(id);
    if (!layer) continue;
    const hits: Array<Hit & { dy: number }> = [];
    for (const f of layer.frames) {
      const b = f.bounds;
      const p = plateAt(f.frame);
      if (!b || !p || !f.visible || f.opacity <= lim.visibleOpacity) continue;
      const base = b.y + b.height;
      const cx = b.x + b.width / 2;
      let best: { dist: number; dy: number } | null = null;
      for (const s of spec.map.surfaces) {
        const band = bandOf(s, p);
        if (cx < band.left || cx > band.right) continue;
        const dist = base < band.top ? band.top - base : base > band.bottom ? base - band.bottom : 0;
        const dy = (band.top + band.bottom) / 2 - base;
        if (!best || dist < best.dist) best = { dist, dy };
      }
      if (!best) hits.push({ frame: f.frame, value: bake.height, dy: 0 });
      else if (best.dist > tol) hits.push({ frame: f.frame, value: best.dist, dy: best.dy });
    }
    if (!hits.length) continue;
    const worst = hits.reduce((a, c) => (c.value > a.value ? c : a));
    const noSurface = worst.dy === 0;
    if (!noSurface) moves.push({ subject: id, dy: r1(worst.dy) });
    groups.push(
      makeGroup(
        'NOT_GROUNDED',
        id,
        hits,
        tol,
        (w) =>
          noSurface
            ? `no surface of the plate lies under "${id}" at frame ${w.frame}`
            : `the base of "${id}" is ${r1(w.value)} px off the nearest surface at frame ${w.frame} (it ${worst.dy > 0 ? 'floats above the back edge' : 'hangs past the front edge'})`,
        () => (noSurface ? `move "${id}" over one of: ${spec.map.surfaces.map((s) => s.name).join(', ') || 'no surfaces read'}` : `move its base ${r1(worst.dy)} px (to the middle of the surface)`),
      ),
    );
  }

  // COVERS_SUBJECT and TEXT_ON_BUSY
  const order = bake.layers.map((l) => l.id);
  const shapesBefore = (id: string): BakedLayer[] =>
    bake.layers.slice(0, order.indexOf(id)).filter((l) => l.id !== spec.plate && byId.get(l.id)?.type === 'shape');
  const calm = calmQuadrants(spec.map);
  for (const tl of bake.layers) {
    if (byId.get(tl.id)?.type !== 'text') continue;
    for (const sid of spec.grounded) {
      const sl = baked.get(sid);
      if (!sl) continue;
      const hits: Hit[] = [];
      for (const f of tl.frames) {
        const sf = sl.frames[f.frame];
        if (!f.bounds || !sf?.bounds || f.opacity <= lim.readableOpacity || sf.opacity <= lim.visibleOpacity) continue;
        const area = f.bounds.width * f.bounds.height;
        if (area <= 0) continue;
        const frac = overlapArea(f.bounds, sf.bounds) / area;
        if (frac > lim.coverFrac) hits.push({ frame: f.frame, value: frac });
      }
      if (hits.length)
        groups.push(
          makeGroup(
            'COVERS_SUBJECT',
            `${tl.id}+${sid}`,
            hits,
            lim.coverFrac,
            (w) => `text "${tl.id}" lies ${r1(w.value * 100)}% on "${sid}" at frame ${w.frame}`,
            () => `move "${tl.id}" off the subject, into ${calm[0]} (the calmest quadrant)`,
          ),
        );
    }

    const backs = shapesBefore(tl.id);
    const busy: Hit[] = [];
    for (const f of tl.frames) {
      const p = plateAt(f.frame);
      const b = f.bounds;
      if (!b || !p || f.opacity <= lim.readableOpacity || b.width <= 0) continue;
      const backed = backs.some((s) => {
        const sf = s.frames[f.frame];
        return !!sf?.bounds && sf.opacity >= lim.backingOpacity && contains(sf.bounds, b);
      });
      if (backed) continue;
      const score = busyUnder(spec.map, (b.x - p.x) / p.width, (b.y - p.y) / p.height, (b.x + b.width - p.x) / p.width, (b.y + b.height - p.y) / p.height);
      if (score > lim.busyLimit) busy.push({ frame: f.frame, value: score });
    }
    if (busy.length)
      warnings.push(
        makeGroup(
          'TEXT_ON_BUSY',
          tl.id,
          busy,
          lim.busyLimit,
          (w) => `text "${tl.id}" sits on a busy patch of the plate (busy ${r3(w.value)}) at frame ${w.frame} with nothing behind it`,
          () => `move it into ${calm[0]} or ${calm[1]} (the calmest quadrants), or put a backing behind it`,
        ),
      );
  }

  groups.sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind) || a.subject.localeCompare(b.subject));
  return { ok: groups.length === 0, groups, warnings, moves };
}
