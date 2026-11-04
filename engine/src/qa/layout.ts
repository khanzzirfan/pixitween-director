import type { MotionDoc } from '../schema';
import { bakeDoc, type BakedDoc, type Bounds } from './bake';
import { flatten, makeGroup, overlapArea, type Hit } from './placement';
import type { QaGroup } from './qa';

// qaLayout: is the stack in the right order, and does each piece sit inside the thing it belongs in, on every frame?
// It reads only JSON — the baked boxes and the draw order of the doc — so it needs no render. Two rules:
//   LAYER_ORDER    a layer of a higher tier is drawn BEFORE a lower-tier layer it overlaps (so the lower one hides it):
//                  backdrop < subject < overlay < text, and a piece drawn before its own container.
//   NOT_CONTAINED  a piece (the price) leaves its container (the badge ring) on some frame, e.g. while the badge pops.

/** From the back of the stack to the front: the plate, the product, shapes and badges laid over it, then type. */
export type LayoutTier = 'backdrop' | 'subject' | 'overlay' | 'text';
const TIER_RANK: Record<LayoutTier, number> = { backdrop: 0, subject: 1, overlay: 2, text: 3 };

export interface LayoutSpec {
  /** The tier of each layer worth checking; a layer that is not listed (a grade, a shadow, a border) is never checked. */
  tiers: Record<string, LayoutTier>;
  /** `content` must stay inside `container` and be drawn after it. */
  contains: Array<{ container: string; content: string }>;
}

export interface LayoutLimits {
  /** A layer counts as visible above this effective opacity. */
  visibleOpacity: number;
  /** Doc px a piece may overhang its container (rounding). */
  containTolPx: number;
  /** Doc px² of overlap below which two layers do not count as overlapping. */
  overlapMinPx2: number;
}

export const LAYOUT_LIMITS: LayoutLimits = { visibleOpacity: 0.05, containTolPx: 1, overlapMinPx2: 4 };

export interface LayoutReport {
  ok: boolean;
  groups: QaGroup[];
}

const r1 = (n: number): number => Math.round(n * 10) / 10;

/** Doc px by which `inner` leaves `outer` (0 when inside). An ellipse container is tested at the corners of the box. */
function overhang(outer: Bounds, inner: Bounds, ellipse: boolean): number {
  if (ellipse) {
    const rx = outer.width / 2;
    const ry = outer.height / 2;
    if (rx <= 0 || ry <= 0) return 0;
    const cx = outer.x + rx;
    const cy = outer.y + ry;
    let worst = 0;
    for (const x of [inner.x, inner.x + inner.width]) {
      for (const y of [inner.y, inner.y + inner.height]) {
        const d = Math.hypot((x - cx) / rx, (y - cy) / ry);
        worst = Math.max(worst, (d - 1) * Math.min(rx, ry));
      }
    }
    return worst;
  }
  return Math.max(0, outer.x - inner.x, outer.y - inner.y, inner.x + inner.width - (outer.x + outer.width), inner.y + inner.height - (outer.y + outer.height));
}

export function qaLayout(doc: MotionDoc, spec: LayoutSpec, bake: BakedDoc = bakeDoc(doc), limits: Partial<LayoutLimits> = {}): LayoutReport {
  const lim: LayoutLimits = { ...LAYOUT_LIMITS, ...limits };
  const byId = new Map(flatten(doc.layers).map((l) => [l.id, l] as const));
  const order = bake.layers.map((l) => l.id);
  const baked = new Map(bake.layers.map((l) => [l.id, l] as const));
  const groups: QaGroup[] = [];
  const shown = (id: string, f: number): Bounds | null => {
    const fr = baked.get(id)?.frames[f];
    return fr?.bounds && fr.visible && fr.opacity > lim.visibleOpacity ? fr.bounds : null;
  };

  // LAYER_ORDER: a back-tier layer drawn after (in front of) a front-tier layer it overlaps hides it
  const listed = order.filter((id) => spec.tiers[id]);
  for (let a = 0; a < listed.length; a++) {
    for (let b = a + 1; b < listed.length; b++) {
      const early = listed[a]!;
      const late = listed[b]!;
      if (TIER_RANK[spec.tiers[early]!] <= TIER_RANK[spec.tiers[late]!]) continue;
      const hits: Hit[] = [];
      for (let f = 0; f < bake.frameCount; f++) {
        const be = shown(early, f);
        const bl = shown(late, f);
        if (!be || !bl) continue;
        const area = overlapArea(be, bl);
        if (area > lim.overlapMinPx2) hits.push({ frame: f, value: area });
      }
      if (hits.length)
        groups.push(
          makeGroup(
            'LAYER_ORDER',
            `${early}+${late}`,
            hits,
            lim.overlapMinPx2,
            (w) => `"${late}" (${spec.tiers[late]}) is drawn after "${early}" (${spec.tiers[early]}) and covers ${r1(w.value)} px² of it at frame ${w.frame}`,
            () => `draw "${early}" after "${late}" (stack: backdrop, subject, overlay, text)`,
          ),
        );
    }
  }

  // contains: drawn after its container, and inside it on every frame
  for (const { container, content } of spec.contains) {
    const ellipse = (byId.get(container) as { shape?: string } | undefined)?.shape === 'ellipse';
    if (order.indexOf(content) >= 0 && order.indexOf(container) >= 0 && order.indexOf(content) < order.indexOf(container)) {
      const hits: Hit[] = [];
      for (let f = 0; f < bake.frameCount; f++) if (shown(content, f) && shown(container, f)) hits.push({ frame: f, value: 1 });
      if (hits.length)
        groups.push(makeGroup('LAYER_ORDER', `${content}+${container}`, hits, 0, () => `"${content}" is drawn before its container "${container}", so the container hides it`, () => `draw "${content}" after "${container}"`));
    }
    const hits: Hit[] = [];
    for (let f = 0; f < bake.frameCount; f++) {
      const out = shown(container, f);
      const inn = shown(content, f);
      if (!out || !inn) continue;
      const over = overhang(out, inn, ellipse);
      if (over > lim.containTolPx) hits.push({ frame: f, value: over });
    }
    if (hits.length)
      groups.push(
        makeGroup(
          'NOT_CONTAINED',
          `${content}+${container}`,
          hits,
          lim.containTolPx,
          (w) => `"${content}" leaves its container "${container}" by ${r1(w.value)} px at frame ${w.frame}`,
          (w) => `shrink "${content}" by ${r1(w.value * 2)} px or enlarge "${container}"`,
        ),
      );
  }

  groups.sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind) || a.subject.localeCompare(b.subject));
  return { ok: groups.length === 0, groups };
}
