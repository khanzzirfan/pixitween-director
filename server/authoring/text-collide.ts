// The last word on text placement: no two text layers of a shot say the same thing, no two that are on screen together
// overlap, and no text sits over the product. Runs after the finish has wrapped the type, since a line break the builder
// never saw can make two lines collide. Text that slides in keeps its slide: every key moves by the same amount.
import { layerBoxAt } from '../review/geometry';
import type { Box } from '../review/types';
import { removeLayer } from './layers';
import { readDirector } from './meta';
import type { Comp, Obj } from './types';

/** Space kept between two blocks, as a share of the frame height. */
const GAP = 0.015;
/** Text stays inside this inset from the top and bottom edge. */
const SAFE = 0.05;
const SAMPLES = 8;
/** Text in front of the product may cover it by this share of the text's own area (the R1 rule's limit). */
const OVER_PRODUCT = 0.15;

const words = (s: unknown): string => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().toLowerCase() : '');
/** An id the model made as a second try at a layer ("hero:headline-2"). The first one is kept. */
const isRetry = (id: string): boolean => /-\d+$/.test(id);
const area = (b: Box) => Math.max(0, b.right - b.left) * Math.max(0, b.bottom - b.top);
const overlapArea = (a: Box, b: Box) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

function shiftY(layer: Obj, dy: number): void {
  const p = layer.transform?.position;
  if (Array.isArray(p) && typeof p[0] === 'number') layer.transform.position = [p[0], p[1] + dy];
  else if (Array.isArray(p)) layer.transform.position = p.map((k: Obj) => ({ ...k, v: [k.v[0], k.v[1] + dy] }));
}

const boxAt = (c: Comp, id: string, f: number) => {
  try {
    return layerBoxAt(c, id, f);
  } catch {
    return undefined;
  }
};

/** Removes repeated text, then moves text off the product and apart. Returns the ids it removed and the ids it moved. */
export function separateText(input: Comp): { comp: Comp; removed: string[]; moved: string[] } {
  let c = input;
  const removed: string[] = [];
  const moved: string[] = [];
  const meta = readDirector(c);
  const note = (id: string) => void (moved.includes(id) || moved.push(id));

  for (const [sceneId, scene] of Object.entries(meta.scenes)) {
    if (scene.mode === 'generate') continue;
    const idsOf = (role: 'text' | 'product') =>
      (((c.precomps as Record<string, Obj>)[scene.precompId]?.layers ?? []) as Obj[])
        .filter((l) => {
          const m = readDirector(c).layers[l.id];
          return m?.sceneId === sceneId && (role === 'text' ? l.kind === 'text' : m.role === 'product' || m.role === 'product3d');
        })
        .map((l) => l.id as string);

    // the same words twice in one shot: keep the original, drop the retry
    const seen = new Set<string>();
    for (const id of [...idsOf('text')].sort((a, b) => Number(isRetry(a)) - Number(isRetry(b)))) {
      const layer = ((c.precomps as Record<string, Obj>)[scene.precompId]!.layers as Obj[]).find((l) => l.id === id)!;
      const key = words(layer.source);
      if (!key) continue;
      if (seen.has(key)) {
        c = removeLayer(c, id);
        removed.push(id);
      } else seen.add(key);
    }

    const p = (c.precomps as Record<string, Obj>)[scene.precompId]!;
    const layerOf = (id: string) => (p.layers as Obj[]).find((l) => l.id === id)!;
    const H = p.height as number;
    const frames = Array.from({ length: SAMPLES }, (_, i) => Math.round((i * (scene.durationFrames - 1)) / (SAMPLES - 1)));
    const product = idsOf('product')[0];

    /** Text in front of the product, over more than the R1 limit, goes above or below where the product travels. */
    const offProduct = (): boolean => {
      if (!product) return false;
      let changed = false;
      for (const id of idsOf('text')) {
        let hit: { text: Box; reach: Box } | undefined;
        for (const f of frames) {
          const t = boxAt(c, id, f);
          const pr = boxAt(c, product, f);
          if (!t || !pr || !t.visible || !pr.visible || t.opacity < 0.3 || pr.opacity < 0.3 || t.drawIndex < pr.drawIndex) continue;
          if (overlapArea(t.box, pr.box) / Math.max(1, area(t.box)) <= OVER_PRODUCT) continue;
          // the whole span the product covers while this text is up, so the move holds for the whole shot
          const reach = frames
            .map((g) => ({ t: boxAt(c, id, g), pr: boxAt(c, product, g) }))
            .filter((x) => x.t?.visible && x.pr?.visible && x.t.opacity >= 0.3)
            .reduce((u, x) => ({ left: Math.min(u.left, x.pr!.box.left), top: Math.min(u.top, x.pr!.box.top), right: Math.max(u.right, x.pr!.box.right), bottom: Math.max(u.bottom, x.pr!.box.bottom) }), pr.box);
          hit = { text: t.box, reach };
          break;
        }
        if (!hit) continue;
        const h = hit.text.bottom - hit.text.top;
        const above = hit.reach.top - GAP * H - h;
        const below = hit.reach.bottom + GAP * H;
        const fitsAbove = above >= SAFE * H;
        const fitsBelow = below + h <= (1 - SAFE) * H;
        let top: number;
        if (fitsAbove && fitsBelow) top = Math.abs(above - hit.text.top) <= Math.abs(below - hit.text.top) ? above : below;
        else if (fitsAbove) top = above;
        else if (fitsBelow) top = below;
        // no clear band: the side with more room, kept inside the frame
        else top = hit.reach.top - SAFE * H >= (1 - SAFE) * H - hit.reach.bottom ? SAFE * H : (1 - SAFE) * H - h;
        const dy = top - hit.text.top;
        if (Math.abs(dy) < 1) continue;
        shiftY(layerOf(id), dy);
        note(id);
        changed = true;
      }
      return changed;
    };

    /** Two text blocks on screen together never overlap: the lower one goes down, or the upper one up when there is no room below. */
    const apart = (): boolean => {
      let changed = false;
      const ids = idsOf('text');
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          for (const f of frames) {
            const a = boxAt(c, ids[i]!, f);
            const b = boxAt(c, ids[j]!, f);
            if (!a || !b) break;
            if (!a.visible || !b.visible || a.opacity < 0.3 || b.opacity < 0.3) continue;
            const [up, down, downId, upId] = a.box.top + a.box.bottom <= b.box.top + b.box.bottom ? [a, b, ids[j]!, ids[i]!] : [b, a, ids[i]!, ids[j]!];
            const xOverlap = Math.min(up.box.right, down.box.right) - Math.max(up.box.left, down.box.left);
            const need = up.box.bottom + GAP * H - down.box.top;
            if (xOverlap <= 0 || need <= 0) continue;
            const downBy = Math.min(need, Math.max(0, (1 - SAFE) * H - down.box.bottom));
            const upBy = Math.min(need - downBy, Math.max(0, up.box.top - SAFE * H));
            if (downBy > 0) {
              shiftY(layerOf(downId), downBy);
              note(downId);
            }
            if (upBy > 0) {
              shiftY(layerOf(upId), -upBy);
              note(upId);
            }
            if (downBy + upBy > 0) changed = true;
            break;
          }
        }
      }
      return changed;
    };

    for (let round = 0; round < 4; round++) {
      const a = offProduct();
      const b = apart();
      if (!a && !b) break;
    }
  }
  return { comp: c, removed, moved };
}
