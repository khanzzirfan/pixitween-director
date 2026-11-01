// Owned by S12c. Cross-scene consistency, checked by code (design.md 5.12): the S5a rules plus three drift checks,
// so the film looks like one film. Drift is a warning for the showrunner, never a reason to refuse finish.
import type { Buffer } from 'node:buffer';
import type { Job, StyleBible } from '@shared/crew';
import type { Storyboard } from '@shared/storyboard';
import type { Comp, Obj } from '../authoring/types';
import { layerBoxAt, listScenes } from '../review/geometry';
import { runRules } from '../review/rules';
import type { Finding } from '../review/types';
import { boxH } from '../review/types';
import { BIBLE_FONT_STACKS } from '../authoring/constants';
import { createId } from './ids';
import type { WorkerResult } from './scheduler';
import type { CrewCtx } from './showrunner-tools';

/** Same shot type, product taller than this much above the smaller one: a jump at the cut. */
export const SCALE_DRIFT = 0.35;
/** RGB distance from every bible colour that counts as a different colour. */
export const PALETTE_DISTANCE = 48;

export type ContinuityFinding = Omit<Finding, 'rule'> & { rule: Finding['rule'] | 'C1' | 'C2' | 'C3' };

const rgb = (hex: string): [number, number, number] | undefined => {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  return m ? [parseInt(m[1]!.slice(0, 2), 16), parseInt(m[1]!.slice(2, 4), 16), parseInt(m[1]!.slice(4), 16)] : undefined;
};
const distance = (a: [number, number, number], b: [number, number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
/** Pure white and black are the defaults for text and shadows, so they are never a drift. */
const NEUTRALS = [rgb('#ffffff')!, rgb('#000000')!];

const layersOf = (comp: Comp, precompId: string): Obj[] => (((comp.precomps as Record<string, Obj>)[precompId]?.layers ?? []) as Obj[]);
const roleOf = (comp: Comp, layerId: string): string | undefined => (comp.meta as { director?: { layers?: Record<string, { role: string }> } } | undefined)?.director?.layers?.[layerId]?.role;

function scaleDrift(comp: Comp, storyboard: Storyboard | undefined): ContinuityFinding[] {
  if (!storyboard) return [];
  const heights = new Map<string, { sceneId: string; shotType: string; h: number; layerId: string }>();
  for (const s of listScenes(comp)) {
    if (s.mode === 'generate') continue;
    const product = layersOf(comp, s.precompId).find((l) => ['product', 'product3d'].includes(roleOf(comp, l.id) ?? ''));
    const shot = storyboard.scenes.find((x) => x.id === s.sceneId)?.shotType;
    if (!product || !shot) continue;
    try {
      const { box } = layerBoxAt(comp, product.id, Math.floor(s.durationFrames / 2));
      heights.set(s.sceneId, { sceneId: s.sceneId, shotType: shot, h: boxH(box) / s.height, layerId: product.id });
    } catch {
      // a layer the geometry cannot place is the rules' business, not continuity's
    }
  }
  const out: ContinuityFinding[] = [];
  for (const shot of new Set([...heights.values()].map((h) => h.shotType))) {
    const group = [...heights.values()].filter((h) => h.shotType === shot);
    const first = group[0]!;
    for (const g of group.slice(1)) {
      const [small, big] = first.h < g.h ? [first.h, g.h] : [g.h, first.h];
      if (small > 0 && big / small - 1 > SCALE_DRIFT)
        out.push({
          id: `C1:${g.sceneId}:product-scale-drift`, rule: 'C1', kind: 'product-scale-drift', severity: 'warn', sceneId: g.sceneId, layerId: g.layerId,
          evidence: `the product is ${Math.round(g.h * 100)} % of the frame high in ${g.sceneId} but ${Math.round(first.h * 100)} % in ${first.sceneId}, both ${shot} shots`,
          metrics: { heightFraction: Math.round(g.h * 1000) / 1000, otherScene: first.sceneId, otherHeightFraction: Math.round(first.h * 1000) / 1000 },
        });
    }
  }
  return out;
}

function paletteDrift(comp: Comp, bible: StyleBible): ContinuityFinding[] {
  const colours = bible.palette.map(rgb).filter((c): c is [number, number, number] => !!c);
  const out: ContinuityFinding[] = [];
  for (const s of listScenes(comp)) {
    for (const l of layersOf(comp, s.precompId)) {
      const fill = l.kind === 'text' ? l.style?.fill : l.kind === 'shape' ? l.fill : undefined;
      const c = typeof fill === 'string' ? rgb(fill) : undefined;
      if (!c || NEUTRALS.some((n) => distance(c, n) <= 12)) continue;
      const nearest = Math.min(...colours.map((p) => distance(c, p)));
      if (nearest > PALETTE_DISTANCE)
        out.push({
          id: `C2:${l.id}:palette-drift`, rule: 'C2', kind: 'palette-drift', severity: 'warn', sceneId: s.sceneId, layerId: l.id,
          evidence: `${l.id} is filled ${fill}, ${Math.round(nearest)} away from the nearest style bible colour`,
          metrics: { fill: String(fill), distance: Math.round(nearest) },
        });
    }
  }
  return out;
}

function typeDrift(comp: Comp, bible: StyleBible): ContinuityFinding[] {
  const out: ContinuityFinding[] = [];
  for (const s of listScenes(comp)) {
    for (const l of layersOf(comp, s.precompId)) {
      if (l.kind !== 'text' || roleOf(comp, l.id) !== 'headline') continue;
      const font = l.style?.font;
      const weight = l.style?.weight;
      const expected = BIBLE_FONT_STACKS[bible.type.font];
      if (font !== expected || weight !== bible.type.weight)
        out.push({
          id: `C3:${l.id}:type-drift`, rule: 'C3', kind: 'type-drift', severity: 'warn', sceneId: s.sceneId, layerId: l.id,
          evidence: `${l.id} is set in ${String(font)} ${String(weight)} but the style bible says ${expected} ${bible.type.weight}`,
          metrics: { font: String(font), weight: String(weight) },
        });
    }
  }
  return out;
}

/** The S5a rules for every scene, plus the three cross-scene checks. Without a bible only the scale check runs. */
export async function runContinuity(
  comp: Comp,
  assets: { read(id: string): Promise<Buffer> } | null,
  bible?: StyleBible,
  storyboard?: Storyboard,
): Promise<ContinuityFinding[]> {
  const { findings } = await runRules(comp, assets, storyboard ? { storyboard } : {});
  return [...findings, ...scaleDrift(comp, storyboard), ...(bible ? [...paletteDrift(comp, bible), ...typeDrift(comp, bible)] : [])];
}

/** The findings each film's last continuity run reported, so a run pushes only what is new. */
const lastSeen = new Map<string, Set<string>>();

export async function runContinuityJob(job: Job, signal: AbortSignal, crew: CrewCtx): Promise<WorkerResult> {
  if (signal.aborted) throw Object.assign(new Error('The job was stopped'), { name: 'AbortError' });
  crew.emit({ type: 'crew.agent', lane: 'continuity', worker: 'continuity', state: 'working', jobId: job.id, model: 'rules' });
  try {
    const film = await crew.films.get(job.filmId);
    if (!film.composition) return { summary: 'no composition yet', model: 'rules' };
    const found = await runContinuity(film.composition as Comp, { read: (id: string) => crew.toolCtx.assets.read(id) }, film.styleBible, film.storyboard);
    const previous = lastSeen.get(job.filmId) ?? new Set<string>();
    const fresh = found.filter((f) => !previous.has(f.id));
    lastSeen.set(job.filmId, new Set(found.map((f) => f.id)));
    for (const f of fresh) crew.emit({ type: 'review.finding', sceneId: f.sceneId, kind: f.kind, atSec: f.atSec, evidence: f.evidence, deterministic: true });
    if (fresh.length)
      crew.inbox.push({
        id: createId('i'),
        at: new Date().toISOString(),
        from: 'continuity',
        jobId: job.id,
        text: fresh.map((f) => `${f.sceneId} ${f.severity === 'error' ? 'ERROR ' : ''}${f.kind}: ${f.evidence}`).join('; ').slice(0, 1900),
      });
    return { summary: found.length ? `${found.length} finding${found.length > 1 ? 's' : ''}, ${fresh.length} new` : 'no continuity issues', model: 'rules' };
  } finally {
    crew.emit({ type: 'crew.agent', lane: 'continuity', worker: 'continuity', state: 'idle', jobId: job.id });
  }
}
