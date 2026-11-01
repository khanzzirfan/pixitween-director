// Ported from the upstream AEP schema (types/aep/parse.ts, MIT).
import type { ZodError } from "zod";
import { aepCompositionSchema, type AepCompositionJson } from "./composition";
import { coerceLegacyTextAlign } from "./text-runs";

export function parseAepComposition(json: unknown): AepCompositionJson {
  return aepCompositionSchema.parse(coerceLegacyTextAlign(json));
}

export type AepParseResult =
  | { success: true; data: AepCompositionJson }
  | { success: false; error: ZodError };

export function parseAepCompositionSafe(json: unknown): AepParseResult {
  const result = aepCompositionSchema.safeParse(coerceLegacyTextAlign(json));
  if (result.success) return { success: true, data: result.data };
  return { success: false, error: result.error };
}
