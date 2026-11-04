// Ported from the upstream AEP schema (types/aep/composition.ts, MIT).
import { z } from "zod";
import { aepLayerSchema, type AepLayer, type AepStageMemberLayer } from "./layer";
import { STAGE3D_LIMITS, isStageMember, usesCinematicFields } from "./stage3d";
import { aepAssetMapSchema, type AepAssetMap } from "./asset";
import { aepPostFxSchema, type AepPostFx } from "./postFx";
import { aepThemeMapSchema, type AepThemeMap } from "./theme";
import { aepTransitionSchema, transitionLayerIds, type AepTransition } from "./transition";

// SemVer for the schema itself. Parser rejects unknown majors.
export const AEP_SCHEMA_VERSION = "1.12.0";
export const AEP_SCHEMA_MAJOR = 1;

// Schema 1.9.0 introduced `model3d`. Compositions declaring an older
// minor must not carry the new layer kind — same convention used by the
// 1.1.0 track-matte and 1.3.0 is3D gates.
const MODEL3D_MIN_VERSION = "1.4.0";
export const TRANSITIONS_MIN_VERSION = "1.10.0";
export const STAGE3D_MIN_VERSION = "1.11.0";
// Schema 1.12.0: cinematic stage3d — animatable camera, prop material/cards/
// swarms, ground "none" and wall false.
export const STAGE3D_CINEMATIC_MIN_VERSION = "1.12.0";

function versionAtLeast(version: string, minimum: string): boolean {
  const a = version.split(".").map((n) => Number.parseInt(n, 10));
  const b = minimum.split(".").map((n) => Number.parseInt(n, 10));
  for (let i = 0; i < 3; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av > bv) return true;
    if (av < bv) return false;
  }
  return true;
}

const versionSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+$/, "expected semver string like '1.0.0'")
  .refine((v) => {
    const major = Number.parseInt(v.split(".")[0] ?? "", 10);
    return major === AEP_SCHEMA_MAJOR;
  }, `unsupported schema major; this build expects major ${AEP_SCHEMA_MAJOR}`);

const aepFontSchema = z
  .object({
    family: z.string(),
    src: z.string().optional(),
    weight: z.union([z.number(), z.string()]).optional(),
    style: z.enum(["normal", "italic", "oblique"]).optional(),
  })
  .strict();
export type AepFont = z.infer<typeof aepFontSchema>;

// aep-28: per-font 3D resource map. Either `src` (typeface JSON for
// drei `<Text3D>` extrusion) OR `msdf` (atlas json + png pair for the
// instanced MSDF path) — both optional; at least one is required.
const aepFont3DSchema = z
  .object({
    src: z.string().optional(),
    msdf: z
      .object({
        json: z.string(),
        png: z.string(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((v) => v.src != null || v.msdf != null, {
    message: "fonts3D entry must declare at least one of `src` or `msdf`",
  });
export type AepFont3D = z.infer<typeof aepFont3DSchema>;

// Forward-declared interface so the recursive `precomps` field can refer
// back without zod's inference deadlocking. Named `AepCompositionJson` so
// the React component (phase 04) can claim the `AepComposition` name.
export interface AepCompositionJson {
  version: string;
  id: string;
  name?: string;
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
  bgColor?: string;
  layers: AepLayer[];
  assets: AepAssetMap;
  fonts?: AepFont[];
  // aep-28: per-font 3D resource map. Keys match `style.font` strings.
  fonts3D?: Record<string, AepFont3D>;
  precomps?: Record<string, AepCompositionJson>;
  // aep-21: composition-level post-processing FX applied to the 3D
  // sub-scene. Empty / absent => no EffectComposer mounted.
  postFx?: AepPostFx[];
  // aep-29: default theme map. Color fields shaped as `{ themeKey, default }`
  // resolve here; the `<AepComposition theme={...}>` prop overrides.
  theme?: AepThemeMap;
  // aep-30: shader transitions are authored in composition-frame time.
  transitions?: AepTransition[];
  meta?: Record<string, unknown>;
}

const aepCompositionBaseSchema: z.ZodType<AepCompositionJson> = z
  .object({
    version: versionSchema,
    id: z.string().min(1),
    name: z.string().optional(),
    width: z.number().positive(),
    height: z.number().positive(),
    fps: z.number().positive(),
    durationInFrames: z.number().positive(),
    bgColor: z
      .string()
      .regex(/^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/)
      .optional(),
    layers: z.array(aepLayerSchema),
    assets: aepAssetMapSchema,
    fonts: z.array(aepFontSchema).optional(),
    fonts3D: z.record(z.string(), aepFont3DSchema).optional(),
    precomps: z
      .record(
        z.string(),
        z.lazy(() => aepCompositionSchema),
      )
      .optional(),
    postFx: z.array(aepPostFxSchema).optional(),
    theme: aepThemeMapSchema.optional(),
    transitions: z.array(aepTransitionSchema).optional(),
    meta: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

// Structural-validation pass + uniqueness + cycle detection.
export const aepCompositionSchema: z.ZodType<AepCompositionJson> =
  aepCompositionBaseSchema.superRefine((comp, ctx) => {
    // 1. Layer ids unique.
    const seen = new Set<string>();
    for (const layer of comp.layers) {
      if (seen.has(layer.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate layer id: ${layer.id}`,
          path: ["layers"],
        });
      }
      seen.add(layer.id);
    }

    // 2. Parent refs resolve.
    const ids = new Set(comp.layers.map((l: AepLayer) => l.id));
    for (let i = 0; i < comp.layers.length; i++) {
      const l = comp.layers[i];
      const parent = isStageMember(l) ? undefined : l.parent;
      if (parent && !ids.has(parent)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `parent '${parent}' is not a layer in this composition`,
          path: ["layers", i, "parent"],
        });
      }
    }

    // 3. Parent chain has no cycles.
    const byId = new Map<string, AepLayer>(
      comp.layers.map((l: AepLayer) => [l.id, l] as const),
    );
    for (let i = 0; i < comp.layers.length; i++) {
      const start = comp.layers[i];
      const visited = new Set<string>();
      let cursor: AepLayer | undefined = start;
      while (cursor && "parent" in cursor && cursor.parent) {
        if (visited.has(cursor.id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `cyclic parent chain detected at layer '${start.id}'`,
            path: ["layers", i, "parent"],
          });
          break;
        }
        visited.add(cursor.id);
        cursor = byId.get(cursor.parent);
      }
    }

    // 4. Precomp layers reference a composition asset OR an inline precomp.
    for (let i = 0; i < comp.layers.length; i++) {
      const layer = comp.layers[i];
      if (layer.kind !== "precomp") continue;
      const asset = comp.assets[layer.compId];
      const inline = comp.precomps?.[layer.compId];
      if (!asset && !inline) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `precomp layer '${layer.id}' references unknown compId '${layer.compId}'`,
          path: ["layers", i, "compId"],
        });
        continue;
      }
      if (asset && asset.type !== "composition") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `asset '${layer.compId}' is not a composition (got '${asset.type}')`,
          path: ["layers", i, "compId"],
        });
      }
    }

    // 5. Image/video/audio/etc. layers must reference an existing asset.
    const assetBackedKinds = new Set([
      "image",
      "video",
      "audio",
      "gif",
      "lottie",
      "svg",
    ]);
    for (let i = 0; i < comp.layers.length; i++) {
      const layer = comp.layers[i];
      if (!assetBackedKinds.has(layer.kind)) continue;
      const assetId = (layer as { assetId: string }).assetId;
      if (!comp.assets[assetId]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `layer '${layer.id}' references unknown assetId '${assetId}'`,
          path: ["layers", i, "assetId"],
        });
      }
    }

    // 6. Track matte (schema 1.1.0) source must exist in this comp.
    for (let i = 0; i < comp.layers.length; i++) {
      const layer = comp.layers[i];
      const matte = (layer as { trackMatte?: { sourceId: string } }).trackMatte;
      if (matte && !ids.has(matte.sourceId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `trackMatte source '${matte.sourceId}' is not a layer in this composition`,
          path: ["layers", i, "trackMatte", "sourceId"],
        });
      }
    }

    // 7. Schema 1.9.0: `model3d` requires the version that introduced it.
    const hasModel3D = comp.layers.some((l) => l.kind === "model3d");
    if (hasModel3D && !versionAtLeast(comp.version, MODEL3D_MIN_VERSION)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `model3d layers require schema >= ${MODEL3D_MIN_VERSION} (got ${comp.version})`,
        path: ["version"],
      });
    }

    // 9. Transitions require schema 1.10.0 and valid, non-overlapping 2D endpoints.
    const transitions = comp.transitions ?? [];
    if (comp.transitions !== undefined && !versionAtLeast(comp.version, TRANSITIONS_MIN_VERSION)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `transitions require schema >= ${TRANSITIONS_MIN_VERSION} (got ${comp.version})`,
        path: ["version"],
      });
    }
    const transitionIds = new Set<string>();
    const occupiedByLayer = new Map<string, Array<{ start: number; end: number; id: string }>>();
    for (let i = 0; i < transitions.length; i += 1) {
      const transition = transitions[i];
      if (transitionIds.has(transition.id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `duplicate transition id: ${transition.id}`, path: ["transitions", i, "id"] });
      }
      transitionIds.add(transition.id);
      const fromIds = transitionLayerIds(transition.from);
      const toIds = transitionLayerIds(transition.to);
      const fromSet = new Set(fromIds);
      const endpointIds = [...new Set([...fromIds, ...toIds])];
      for (const overlapId of toIds) {
        if (fromSet.has(overlapId)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `transition '${transition.id}' uses layer '${overlapId}' as both from and to`, path: ["transitions", i] });
        }
      }
      for (const layerId of endpointIds) {
        const layer = byId.get(layerId);
        if (!layer) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `transition '${transition.id}' references unknown layer '${layerId}'`, path: ["transitions", i] });
          continue;
        }
        if (layer.kind === "camera" || layer.kind === "light" || layer.kind === "audio" || ("is3D" in layer && layer.is3D === true)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `transition '${transition.id}' endpoint '${layerId}' must be a 2D visual layer`, path: ["transitions", i] });
        }
        const spans = occupiedByLayer.get(layerId) ?? [];
        const start = transition.startFrame;
        const end = start + transition.durationFrames;
        for (const span of spans) {
          if (start < span.end && span.start < end) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: `transition '${transition.id}' overlaps '${span.id}' on layer '${layerId}'`, path: ["transitions", i] });
          }
        }
        spans.push({ start, end, id: transition.id });
        occupiedByLayer.set(layerId, spans);
      }
      if (transition.startFrame + transition.durationFrames > comp.durationInFrames) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `transition '${transition.id}' extends past composition duration`, path: ["transitions", i, "durationFrames"] });
      }
    }

    // 10. `model3d` asset references must resolve: the glTF source and any
    // label/front texture ids. Textures are images; the model is `model`.
    for (let i = 0; i < comp.layers.length; i++) {
      const layer = comp.layers[i];
      if (layer.kind !== "model3d") continue;
      if (layer.source.type === "gltf") {
        const asset = comp.assets[layer.source.assetId];
        if (!asset) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `model3d layer '${layer.id}' references unknown assetId '${layer.source.assetId}'`,
            path: ["layers", i, "source", "assetId"],
          });
        }
      }
      for (const key of ["label", "front"] as const) {
        const assetId = layer.textures?.[key];
        if (!assetId) continue;
        if (!comp.assets[assetId]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `model3d layer '${layer.id}' references unknown texture assetId '${assetId}'`,
            path: ["layers", i, "textures", key],
          });
        }
      }
    }

    // 11. Schema 1.11.0: `stage3d` worlds and their `actor3d` / `prop3d`
    // members. Version gate, same-composition world, per-world limits, attach
    // targets, no 2D references to members, and asset references.
    const worlds = new Map<string, AepLayer>();
    for (const layer of comp.layers) {
      if (layer.kind === "stage3d") worlds.set(layer.id, layer);
    }
    const stageKinds = new Set(["stage3d", "actor3d", "prop3d"]);
    const flaggedKinds = new Set<string>();
    const counts = new Map<
      string,
      { actors: number; props: number; products: number; instances: number }
    >();
    const addIssue = (message: string, path: (string | number)[]) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, message, path });
    const needAsset = (
      layerId: string,
      kind: string,
      assetId: string | undefined,
      path: (string | number)[],
    ) => {
      if (!assetId || comp.assets[assetId]) return;
      addIssue(`${kind} layer '${layerId}' references unknown assetId '${assetId}'`, path);
    };
    const memberById = new Map<string, AepStageMemberLayer>();
    for (const layer of comp.layers) {
      if (isStageMember(layer)) memberById.set(layer.id, layer);
    }

    for (let i = 0; i < comp.layers.length; i++) {
      const layer = comp.layers[i];
      if (stageKinds.has(layer.kind) && !flaggedKinds.has(layer.kind)) {
        if (!versionAtLeast(comp.version, STAGE3D_MIN_VERSION)) {
          flaggedKinds.add(layer.kind);
          addIssue(
            `${layer.kind} layers require schema >= ${STAGE3D_MIN_VERSION} (got ${comp.version})`,
            ["version"],
          );
        }
      }
      const cinematic =
        layer.kind === "stage3d" || isStageMember(layer) ? usesCinematicFields(layer) : null;
      if (cinematic && !versionAtLeast(comp.version, STAGE3D_CINEMATIC_MIN_VERSION)) {
        addIssue(
          `stage3d ${cinematic} requires schema >= ${STAGE3D_CINEMATIC_MIN_VERSION} (got ${comp.version})`,
          ["layers", i],
        );
      }
      if (layer.kind === "stage3d") {
        needAsset(layer.id, "stage3d", layer.set?.backdrop, ["layers", i, "set", "backdrop"]);
        continue;
      }
      if (!isStageMember(layer)) continue;

      if (!worlds.has(layer.stage)) {
        addIssue(
          `${layer.kind} '${layer.id}' stage '${layer.stage}' is not a stage3d layer in this composition`,
          ["layers", i, "stage"],
        );
      } else {
        const c = counts.get(layer.stage) ?? { actors: 0, props: 0, products: 0, instances: 0 };
        counts.set(layer.stage, c);
        if (layer.kind === "actor3d") {
          c.actors += 1;
          if (c.actors === STAGE3D_LIMITS.actors + 1) {
            addIssue(`stage3d '${layer.stage}' allows at most ${STAGE3D_LIMITS.actors} actors (has more)`, ["layers", i]);
          }
        } else if (layer.role === "product") {
          c.products += 1;
          if (c.products === STAGE3D_LIMITS.products + 1) {
            addIssue(`stage3d '${layer.stage}' allows at most ${STAGE3D_LIMITS.products} product (has more)`, ["layers", i]);
          }
        } else {
          c.props += 1;
          if (c.props === STAGE3D_LIMITS.props + 1) {
            addIssue(`stage3d '${layer.stage}' allows at most ${STAGE3D_LIMITS.props} props (has more)`, ["layers", i]);
          }
          c.instances += layer.swarm?.count ?? 1;
          if (c.instances > STAGE3D_LIMITS.instancesPerWorld) {
            addIssue(
              `stage3d '${layer.stage}' allows at most ${STAGE3D_LIMITS.instancesPerWorld} prop instances (has ${c.instances})`,
              ["layers", i],
            );
          }
        }
      }

      if (layer.kind === "actor3d") {
        needAsset(layer.id, "actor3d", layer.assetId, ["layers", i, "assetId"]);
        layer.clips?.forEach((clip, ci) =>
          needAsset(layer.id, "actor3d", clip.clipAssetId, ["layers", i, "clips", ci, "clipAssetId"]),
        );
      } else {
        if (layer.source.type === "gltf") {
          needAsset(layer.id, "prop3d", layer.source.assetId, ["layers", i, "source", "assetId"]);
        } else if (layer.source.type === "text3d") {
          needAsset(layer.id, "prop3d", layer.source.font, ["layers", i, "source", "font"]);
        } else if (layer.source.type === "card") {
          needAsset(layer.id, "prop3d", layer.textures?.front, ["layers", i, "textures", "front"]);
          layer.source.frames?.forEach((assetId, fi) =>
            needAsset(layer.id, "prop3d", assetId, ["layers", i, "source", "frames", fi]),
          );
        }
        needAsset(layer.id, "prop3d", layer.textures?.label, ["layers", i, "textures", "label"]);
        needAsset(layer.id, "prop3d", layer.textures?.front, ["layers", i, "textures", "front"]);
        if (layer.attach) {
          const target = memberById.get(layer.attach.actor);
          if (!target || target.kind !== "actor3d" || target.stage !== layer.stage) {
            addIssue(
              `prop3d '${layer.id}' attach.actor '${layer.attach.actor}' is not an actor3d in stage '${layer.stage}'`,
              ["layers", i, "attach", "actor"],
            );
          }
        }
      }
    }

    // 2D layers may not parent to, matte with, or transition a member.
    const memberRef = (id: string, path: (string | number)[]) => {
      const m = memberById.get(id);
      if (!m) return;
      addIssue(
        `'${id}' is a ${m.kind} member of stage '${m.stage}'; reference the stage3d layer instead`,
        path,
      );
    };
    for (let i = 0; i < comp.layers.length; i++) {
      const layer = comp.layers[i];
      if (isStageMember(layer)) continue;
      if (layer.parent) memberRef(layer.parent, ["layers", i, "parent"]);
      if ("trackMatte" in layer && layer.trackMatte) memberRef(layer.trackMatte.sourceId, ["layers", i, "trackMatte", "sourceId"]);
    }
    transitions.forEach((t, ti) => {
      for (const id of [...transitionLayerIds(t.from), ...transitionLayerIds(t.to)]) {
        memberRef(id, ["transitions", ti]);
      }
    });
  });
