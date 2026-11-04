// Ported from the upstream AEP schema (types/aep/asset.ts, MIT).
import { z } from "zod";

export const aepAssetKindSchema = z.enum([
  "image",
  "video",
  "audio",
  "lottie",
  "gif",
  "svg",
  "font",
  "composition",
  // Schema 1.9.0: glTF/GLB used by `model3d` layers. Kept distinct from
  // `image` so resolvers can serve the right MIME type.
  "model",
]);
export type AepAssetKind = z.infer<typeof aepAssetKindSchema>;

// One entry in the assets map. `src` may be empty for `composition`
// assets — those resolve via the parent comp's nested-comp registry.
export const aepAssetSchema = z
  .object({
    type: aepAssetKindSchema,
    src: z.string(),
    width: z.number().optional(),
    height: z.number().optional(),
    duration: z.number().optional(), // frames; used by video/audio/lottie
  })
  .strict();
export type AepAsset = z.infer<typeof aepAssetSchema>;

export const aepAssetMapSchema = z.record(z.string(), aepAssetSchema);
export type AepAssetMap = z.infer<typeof aepAssetMapSchema>;
