// Ported from the upstream AEP schema (types/aep/stage3d.ts, MIT).
import { z } from "zod";
import type {
  AepActor3DLayer,
  AepLayer,
  AepProp3DLayer,
  AepStage3DLayer,
  AepStageMemberLayer,
} from "./layer";

// aep-31: limits, helpers and layer-level checks for the `stage3d` world and
// its `actor3d` / `prop3d` member layers. The schemas themselves live in
// layer.ts (they need `layerBase` and the model3d sub-schemas); everything here
// is import-type only from layer.ts so the dependency stays one-way.

export const STAGE3D_LIMITS = {
  actors: 3,
  props: 12,
  products: 1,
  spots: 2,
  clipsPerActor: 24,
  instancesPerSwarm: 200,
  instancesPerWorld: 400,
} as const;

export const STAGE3D_DEFAULT_FADE_FRAMES = 6;

export const STAGE_MEMBER_KINDS = ["actor3d", "prop3d"] as const;

export function isStageMember(layer: AepLayer): layer is AepStageMemberLayer {
  return layer.kind === "actor3d" || layer.kind === "prop3d";
}

/** Members of `worldId`, in composition order. */
export function stageMembersOf(
  layers: Iterable<AepLayer>,
  worldId: string,
): AepStageMemberLayer[] {
  const out: AepStageMemberLayer[] = [];
  for (const layer of layers) {
    if (isStageMember(layer) && layer.stage === worldId) out.push(layer);
  }
  return out;
}

type Vec3 = [number, number, number];

const staticVec = (value: Vec3 | { t: number; v: Vec3 }[]): Vec3 | null =>
  Array.isArray(value) && typeof value[0] === "number" ? (value as Vec3) : null;

/** `stage3d` only: a static camera must look at something other than itself. */
export function refineStage3DLayer(
  layer: AepStage3DLayer,
  ctx: z.RefinementCtx,
): void {
  const position = staticVec(layer.camera.position);
  const target = staticVec(layer.camera.target);
  if (!position || !target) return;
  const [px, py, pz] = position;
  const [tx, ty, tz] = target;
  if (Math.hypot(px - tx, py - ty, pz - tz) <= 1e-3) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "stage3d camera position and target must differ",
      path: ["camera", "target"],
    });
  }
}

/** `prop3d` only: swarm/card/billboard constraints (schema 1.12.0). */
export function refineProp3DLayer(
  prop: AepProp3DLayer,
  ctx: z.RefinementCtx,
): void {
  const issue = (message: string, path: (string | number)[]) =>
    ctx.addIssue({ code: z.ZodIssueCode.custom, message, path });
  const isCard = prop.source.type === "card";
  const swarm = prop.swarm;

  if (swarm) {
    if (prop.attach) issue(`prop3d '${prop.id}' swarm cannot be attached`, ["swarm"]);
    if (isCard) issue(`prop3d '${prop.id}' card swarms are not supported`, ["swarm"]);
    if (prop.role === "product") issue(`prop3d '${prop.id}' product cannot be a swarm`, ["swarm"]);
    if (swarm.motion === "orbit" && !swarm.orbit) {
      issue(`prop3d '${prop.id}' orbit swarm needs swarm.orbit`, ["swarm", "orbit"]);
    }
  }

  if (!isCard) {
    if (prop.billboard) {
      issue(`prop3d '${prop.id}' billboard is only valid for a card source`, ["billboard"]);
    }
    if (prop.lit) {
      issue(`prop3d '${prop.id}' lit is only valid for a card source`, ["lit"]);
    }
  } else if (!prop.textures?.front && !(prop.source.type === "card" && prop.source.frames?.length)) {
    issue(`prop3d '${prop.id}' card needs textures.front or source.frames`, ["source"]);
  }
}

/** First schema-1.12.0 field used by this stage layer, or null. */
export function usesCinematicFields(
  layer: AepStage3DLayer | AepStageMemberLayer,
): string | null {
  if (layer.kind === "stage3d") {
    const keyed = (v: unknown) => Array.isArray(v) && typeof v[0] !== "number";
    if (keyed(layer.camera.position)) return "camera.position keyframes";
    if (keyed(layer.camera.target)) return "camera.target keyframes";
    if (keyed(layer.camera.fov)) return "camera.fov keyframes";
    if (layer.set?.ground === "none") return "set.ground \"none\"";
    if (layer.set?.wall === false) return "set.wall false";
    return null;
  }
  if (layer.kind === "prop3d") {
    if (layer.source.type === "card") return "prop3d card source";
    if (layer.material) return "prop3d material";
    if (layer.swarm) return "prop3d swarm";
    if (layer.billboard) return "prop3d billboard";
    if (layer.lit) return "prop3d lit";
  }
  return null;
}

/** `actor3d` only: clips sorted, and spaced so at most two blend at any frame. */
export function refineActor3DLayer(
  actor: AepActor3DLayer,
  ctx: z.RefinementCtx,
): void {
  const clips = actor.clips ?? [];
  for (let i = 1; i < clips.length; i++) {
    const a = clips[i - 1];
    const b = clips[i];
    const path = ["clips", i, "startFrame"];
    if (b.startFrame <= a.startFrame) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `actor '${actor.id}' clips must be sorted by startFrame`,
        path,
      });
      continue;
    }
    const fade = b.fadeFrames ?? STAGE3D_DEFAULT_FADE_FRAMES;
    if (b.startFrame - a.startFrame < fade) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `actor '${actor.id}' clips at frames ${a.startFrame} and ${b.startFrame} are closer than the ${fade}-frame fade`,
        path,
      });
    }
  }
}
