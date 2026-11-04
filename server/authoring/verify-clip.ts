import { bakeDoc, qaDoc, qaLayout, qaPlacement, type LayoutSpec, type QaGroup, type QaKind } from '@engine/qa';
import { parseMotionDoc } from '@engine/schema';
import { aepToMotion } from '../../web/src/motion/aep/index';
import { sanitizeId } from '../../web/src/motion/aep/sanitizeId';
import { baseFromPlate, buildRetailClip, plateOverscan, type RetailClipInput } from './retail-clip';
import { LOOKS } from './looks';
import type { Comp, Obj } from './types';

// The placement verifier: builds a retail clip, converts it to the engine's JSON, bakes every frame without a render and
// checks it three times — qaDoc (off stage, clipped or overlapping text, pops), qaLayout against the stack the builder declared
// (backdrop < subject < overlay < text; the price stays inside its ring) and qaPlacement against the plate's read (the
// pack stands on a surface on every frame, no text on the pack, no bare text on a busy patch). What it can fix it fixes
// on the clip's INPUT (the base line), never on the film, then builds again. What it cannot fix it hands back, so the
// critic or the agent sees it with the frame and the hint.

export const MAX_ROUNDS = 3;
/**
 * What blocks a clip: where things are (the placement and layout kinds, and qaDoc's off stage, clipped and overlapping text). The rest of
 * qaDoc (text size, reading time, pops, never seen) is taste the critic weighs, so it travels as a warning: the price scales in
 * from zero on purpose, and a 34 px size line is small on 1920 but deliberate.
 */
export const BLOCKING: readonly QaKind[] = ['NOT_GROUNDED', 'COVERS_SUBJECT', 'LAYER_ORDER', 'NOT_CONTAINED', 'OFFSTAGE', 'CLIPPED', 'TEXT_OVERLAP'];
const STAGE_H = 1920;

export interface VerifyRound {
  groups: QaGroup[];
  warnings: QaGroup[];
  /** What the fixer changed before the next round, in words. */
  applied: string[];
}

export interface VerifyResult {
  ok: boolean;
  comp: Comp;
  /** The input the last build used: the caller's, plus the fixer's edits. */
  input: RetailClipInput;
  rounds: VerifyRound[];
}

const clipLayers = (c: Comp): Obj[] => ((c.precomps as Record<string, Obj>)['clip']?.layers ?? []) as Obj[];

/** Checks one built clip. The plate and product layers are found by their asset ids. */
export function checkRetailClip(comp: Comp, input: RetailClipInput): { groups: QaGroup[]; warnings: QaGroup[]; moves: Array<{ subject: string; dy: number }>; height: number } {
  const { doc } = aepToMotion(comp as never);
  const parsed = parseMotionDoc(doc);
  if (!parsed.ok) throw new Error(`clip does not convert to a valid doc: ${JSON.stringify(parsed.errors).slice(0, 300)}`);
  const assets = (comp.assets ?? {}) as Record<string, { width?: number; height?: number }>;
  const assetSizes = Object.fromEntries(
    Object.entries(assets)
      .filter(([, a]) => a.width && a.height)
      .map(([id, a]) => [sanitizeId(id), { width: a.width!, height: a.height! }]),
  );
  const bake = bakeDoc(parsed.doc, { assetSizes });
  const qa = qaDoc(parsed.doc, bake);
  const layers = clipLayers(comp);
  const plateLayer = layers.find((l) => l.kind === 'image' && l.assetId === input.plate?.id);
  const grounded = (comp.meta as { layout?: { grounded?: string[] } } | undefined)?.layout?.grounded?.[0];
  const productLayer = layers.find((l) => (grounded ? l.id === grounded : l.kind === 'image' && l.assetId === input.product.id));
  const map = input.plate?.map;
  const look = LOOKS[input.look ?? 'tabletop-hero'];
  // the stack the builder declared (meta.layout): ids in the comp's spelling, converted like the layers
  const declared = (comp.meta as { layout?: LayoutSpec } | undefined)?.layout;
  const layout: LayoutSpec | undefined = declared && {
    tiers: Object.fromEntries(Object.entries(declared.tiers).map(([id, t]) => [sanitizeId(id), t])),
    contains: declared.contains.map((x) => ({ container: sanitizeId(x.container), content: sanitizeId(x.content) })),
  };
  const stack = layout ? qaLayout(parsed.doc, layout, bake).groups : [];
  const split = (groups: QaGroup[], warnings: QaGroup[], moves: Array<{ subject: string; dy: number }>) => ({
    groups: groups.filter((g) => BLOCKING.includes(g.kind)),
    warnings: [...warnings, ...groups.filter((g) => !BLOCKING.includes(g.kind))],
    moves,
    height: bake.height,
  });
  if (!plateLayer || !productLayer || !map || look.plate === null) return split([...stack, ...qa.groups], qa.warnings, []);
  const placed = qaPlacement(parsed.doc, { plate: sanitizeId(String(plateLayer.id)), map: { ...map, source: 'vision' }, grounded: [sanitizeId(String(productLayer.id))] }, bake);
  return split([...placed.groups, ...stack, ...qa.groups], [...placed.warnings, ...qa.warnings], placed.moves);
}

/** Build, check, fix the input, build again; at most MAX_ROUNDS builds. */
export function verifyRetailClip(input: RetailClipInput, maxRounds = MAX_ROUNDS): VerifyResult {
  let cur: RetailClipInput = { ...input };
  const rounds: VerifyRound[] = [];
  for (let n = 0; n < maxRounds; n++) {
    const comp = buildRetailClip(cur);
    const r = checkRetailClip(comp, cur);
    const round: VerifyRound = { groups: r.groups, warnings: r.warnings, applied: [] };
    rounds.push(round);
    if (!r.groups.length) return { ok: true, comp, input: cur, rounds };
    // the one fix the verifier makes itself: move the base line by the measured gap, so the pack stands mid-surface
    const move = r.moves[0];
    if (!move || n === maxRounds - 1) return { ok: false, comp, input: cur, rounds };
    const over = plateOverscan(LOOKS[cur.look ?? 'tabletop-hero']);
    const now = cur.baseY ?? (cur.plate?.map ? baseFromPlate(cur.plate.map, over) : undefined) ?? 0.7;
    const next = Math.round(Math.min(0.83, Math.max(0.4, now + move.dy / (r.height || STAGE_H))) * 1e4) / 1e4;
    if (next === now) return { ok: false, comp, input: cur, rounds };
    round.applied.push(`baseY ${now} -> ${next} (the base of ${move.subject} was ${move.dy} px off the surface middle)`);
    cur = { ...cur, baseY: next };
  }
  const comp = buildRetailClip(cur);
  return { ok: false, comp, input: cur, rounds };
}
