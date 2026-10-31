// Owned by S16b. The critic's checks for a toy-studio shot: three rules computed from the stage JSON at the captured times, and the questions the blind vision review is asked.
// The stage is projected through its locked camera (a pinhole: position, target, vertical field of view, the viewport's aspect), so no render is needed for the rules.
import type { Comp, Obj } from '../authoring/types';
import { lerpNumber, sampleAnimatable } from '../review/sample';
import type { Box, Finding } from '../review/types';
import { boxArea, intersect, round2 } from '../review/types';

export type StageRule = 'S1' | 'S2' | 'S3' | 'S4';
export type StageFinding = Omit<Finding, 'rule'> & { rule: StageRule };

/** More than this share of the product's screen box covered by an actor is a fault. */
export const COVER_LIMIT = 0.4;
/** Two actors closer than this (metres, on the ground) look like one fused figure. */
/** More than this share of an actor's screen box hidden by a prop in front of it is a fault. */
export const HIDE_LIMIT = 0.5;
export const MIN_ACTOR_GAP = 0.6;
/** An actor with no `height` is a toy figure about this tall (metres), as wide as 0.45 of it. */
export const DEFAULT_ACTOR_HEIGHT = 1;
const ACTOR_WIDTH_RATIO = 0.45;
const DEFAULT_PROP_SIZE = 0.3;

export const STAGE_VISION_QUESTIONS = [
  "Is any character's body passing through an object, such as a prop, the floor or another character?",
  'Is the main product clearly visible, and not hidden behind a character?',
  'Is any character cut off by the edge of the frame?',
];

type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

interface Camera {
  position: V3;
  target: V3;
  fov?: number;
}

/** A world point to normalized screen coordinates: x and y in [-1, 1] when inside the frame, and the distance along the view direction (undefined behind the camera). */
export function project(cam: Camera, aspect: number, p: V3): { x: number; y: number; depth: number } | undefined {
  const fwd = norm(sub(cam.target, cam.position));
  const right = norm(cross(fwd, [0, 1, 0]));
  const up = cross(right, fwd);
  const rel = sub(p, cam.position);
  const depth = dot(rel, fwd);
  if (depth <= 1e-6) return undefined;
  const t = Math.tan(((cam.fov ?? 35) * Math.PI) / 360);
  return { x: dot(rel, right) / (depth * t * aspect), y: dot(rel, up) / (depth * t), depth };
}

const vec3 = (a: V3, b: V3, t: number): V3 => [lerpNumber(a[0], b[0], t), lerpNumber(a[1], b[1], t), lerpNumber(a[2], b[2], t)];
const at = (field: unknown, fallback: V3, frame: number): V3 => sampleAnimatable(field as V3, fallback, frame, vec3);
const present = (l: Obj, frame: number) => !l.hidden && frame >= l.inPoint && frame < l.outPoint;

/** The screen box of something standing on the ground at [x, z]: its feet to its head, `width` metres wide, in normalized screen units. */
function standingBox(cam: Camera, aspect: number, x: number, y0: number, z: number, height: number, width: number): { box: Box; depth: number } | undefined {
  const feet = project(cam, aspect, [x, y0, z]);
  const head = project(cam, aspect, [x, y0 + height, z]);
  const side = project(cam, aspect, [x + width / 2, y0, z]);
  if (!feet || !head || !side) return undefined;
  const half = Math.abs(side.x - feet.x);
  return { box: { left: feet.x - half, right: feet.x + half, top: -head.y, bottom: -feet.y }, depth: feet.depth };
}

interface Actor {
  id: string;
  name: string;
  x: number;
  z: number;
  height: number;
}

/** What the critic can say about the stage in one scene at one scene-relative time (in seconds). Empty when the scene has no stage. */
export function stageFindingsAt(comp: Comp, sceneId: string, atSec: number): StageFinding[] {
  const p = (comp.precomps as Record<string, Obj> | undefined)?.[sceneId];
  const layers = (p?.layers ?? []) as Obj[];
  const world = layers.find((l) => l.kind === 'stage3d');
  if (!p || !world) return [];
  const frame = atSec * (comp.fps || 30);
  const aspect = (world.viewport?.width ?? comp.width) / (world.viewport?.height ?? comp.height);
  const cam = world.camera as Camera;
  const local = (id: string) => String(id).slice(sceneId.length + 1);
  const out: StageFinding[] = [];
  const base = { sceneId, atSec: round2(atSec), severity: 'warn' as const, samplesFailing: [round2(atSec)] };

  const actors: Actor[] = layers
    .filter((l) => l.kind === 'actor3d' && l.stage === world.id && present(l, frame))
    .map((l) => {
      const m = at(l.marks, [0, 0, 0], frame);
      return { id: l.id as string, name: local(l.id), x: m[0], z: m[1], height: (l.height as number | undefined) ?? DEFAULT_ACTOR_HEIGHT };
    });

  // S1: the actor stands where the camera cannot see
  for (const a of actors) {
    const s = project(cam, aspect, [a.x, 0, a.z]);
    if (!s || Math.abs(s.x) > 1 || s.y < -1.2) {
      out.push({ ...base, id: `S1:${a.id}:${base.atSec}`, rule: 'S1', kind: 'actor-off-frame', severity: 'error', layerId: a.id, evidence: `${a.name} at ${sceneId} ${base.atSec}s stands at x ${round2(a.x)}, z ${round2(a.z)}, outside what the camera sees`, metrics: { actor: a.name, x: round2(a.x), z: round2(a.z) }, suggestedFix: { tool: 'moveActor', args: { sceneId, actorId: a.name, toMark: [Math.max(-1.5, Math.min(1.5, a.x)), 0, 0], atSec: 0, durationSec: 0.5 } } });
    }
  }

  // S2: an actor in front of the product hides more than COVER_LIMIT of it
  const product = layers.find((l) => l.kind === 'prop3d' && l.role === 'product' && l.stage === world.id && !l.attach && present(l, frame));
  if (product) {
    const pos = at(product.position, [0, 0, 0], frame);
    const size = (product.size as number | undefined) ?? DEFAULT_PROP_SIZE;
    const pb = standingBox(cam, aspect, pos[0], pos[1], pos[2], size, size);
    if (pb && boxArea(pb.box) > 0) {
      for (const a of actors) {
        const ab = standingBox(cam, aspect, a.x, 0, a.z, a.height, a.height * ACTOR_WIDTH_RATIO);
        if (!ab || ab.depth > pb.depth + 0.05) continue; // behind the product does not cover it
        const hit = intersect(ab.box, pb.box);
        const share = hit ? boxArea(hit) / boxArea(pb.box) : 0;
        if (share > COVER_LIMIT)
          out.push({ ...base, id: `S2:${a.id}:${base.atSec}`, rule: 'S2', kind: 'product-covered', severity: 'error', layerId: product.id, evidence: `${a.name} covers ${Math.round(share * 100)}% of the product (${local(product.id)}) at ${sceneId} ${base.atSec}s`, metrics: { actor: a.name, covered: round2(share) }, suggestedFix: { tool: 'moveActor', args: { sceneId, actorId: a.name, toMark: [a.x < 0 ? a.x - 1 : a.x + 1, a.z, 0], atSec: 0, durationSec: 0.5 } } });
      }
    }
  }

  // S4: a prop standing in front of an actor hides more than HIDE_LIMIT of the actor
  for (const prop of layers.filter((l) => l.kind === 'prop3d' && l.stage === world.id && !l.attach && present(l, frame))) {
    const pos = at(prop.position, [0, 0, 0], frame);
    const size = (prop.size as number | undefined) ?? DEFAULT_PROP_SIZE;
    const pb = standingBox(cam, aspect, pos[0], pos[1], pos[2], size, size);
    if (!pb) continue;
    for (const a of actors) {
      const ab = standingBox(cam, aspect, a.x, 0, a.z, a.height, a.height * ACTOR_WIDTH_RATIO);
      if (!ab || boxArea(ab.box) <= 0 || pb.depth > ab.depth - 0.05) continue; // only a prop in front hides the actor
      const hit = intersect(pb.box, ab.box);
      const share = hit ? boxArea(hit) / boxArea(ab.box) : 0;
      if (share > HIDE_LIMIT)
        out.push({ ...base, id: `S4:${prop.id}:${a.id}:${base.atSec}`, rule: 'S4', kind: 'actor-hidden', severity: 'error', layerId: a.id, evidence: `${local(prop.id)} hides ${Math.round(share * 100)}% of ${a.name} at ${sceneId} ${base.atSec}s`, metrics: { actor: a.name, prop: local(prop.id), hidden: round2(share) }, suggestedFix: { tool: 'placeProp', args: { sceneId, propId: local(prop.id), size: 0.3, position: [pos[0] + 1.5, pos[1], pos[2] - 1] } } });
    }
  }

  // S3: two actors too close together
  for (let i = 0; i < actors.length; i++) {
    for (let j = i + 1; j < actors.length; j++) {
      const gap = Math.hypot(actors[i]!.x - actors[j]!.x, actors[i]!.z - actors[j]!.z);
      if (gap < MIN_ACTOR_GAP)
        out.push({ ...base, id: `S3:${actors[i]!.id}:${actors[j]!.id}:${base.atSec}`, rule: 'S3', kind: 'actors-too-close', layerId: actors[i]!.id, evidence: `${actors[i]!.name} and ${actors[j]!.name} are ${round2(gap)} m apart at ${sceneId} ${base.atSec}s`, metrics: { actors: `${actors[i]!.name}, ${actors[j]!.name}`, gap: round2(gap) } });
    }
  }
  return out;
}

/** The findings at every captured time, one per rule and layer: a fault that holds across several frames is reported once, with all the seconds. */
export function stageFindings(comp: Comp, sceneId: string, timesSec: number[]): StageFinding[] {
  const merged = new Map<string, StageFinding>();
  for (const t of timesSec) {
    for (const f of stageFindingsAt(comp, sceneId, t)) {
      const key = `${f.rule}:${f.layerId}:${f.metrics.actor ?? f.metrics.actors}:${f.metrics.prop ?? ''}`;
      const prev = merged.get(key);
      if (!prev) merged.set(key, f);
      else prev.samplesFailing = [...(prev.samplesFailing ?? []), t];
    }
  }
  return [...merged.values()];
}

export const sceneHasStage = (comp: Comp, sceneId: string): boolean => (((comp.precomps as Record<string, Obj> | undefined)?.[sceneId]?.layers ?? []) as Obj[]).some((l) => l.kind === 'stage3d');
