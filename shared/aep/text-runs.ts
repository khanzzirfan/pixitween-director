// Ported from the upstream AEP schema (types/aep/text-runs.ts, MIT).
import { z } from "zod";
import { aepAnimatableOf } from "./transform";

// Re-declared here to avoid a circular import with layer.ts.
const aepColorSchema = z
  .string()
  .regex(
    /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/,
    "expected #RRGGBB or #RRGGBBAA",
  );

// Per-character style run. `from` inclusive, `to` exclusive. Each field
// is optional — undefined means "inherit the layer-level style." Runs
// MUST NOT overlap (enforced via `resolveTextRuns`). Coverage gaps are
// filled at runtime with the layer defaults.
export const aepTextStyleRunSchema = z
  .object({
    from: z.number().int().min(0),
    to: z.number().int().min(1),
    font: z.string().optional(),
    size: aepAnimatableOf(z.number().min(0)).optional(),
    fill: aepAnimatableOf(aepColorSchema).optional(),
    weight: z.union([z.number(), z.string()]).optional(),
    italic: z.boolean().optional(),
    tracking: aepAnimatableOf(z.number()).optional(),
    baselineShift: aepAnimatableOf(z.number()).optional(),
  })
  .strict()
  .refine((r) => r.to > r.from, {
    message: "to must exceed from",
    path: ["to"],
  });

export type AepTextStyleRun = z.infer<typeof aepTextStyleRunSchema>;

export const AEP_TEXT_ALIGN_VALUES = [
  "left",
  "center",
  "right",
  "justify-full",
  "justify-last-left",
  "justify-last-center",
  "justify-last-right",
] as const;

// AE-exact justify enum. Legacy `"justify"` (CSS-style) is coerced to
// `"justify-last-left"` upstream of zod by `coerceLegacyTextAlign` so
// the schema input/output types stay aligned (composition.ts holds a
// strict typed cast that requires this).
export const aepTextAlignSchema = z.enum(AEP_TEXT_ALIGN_VALUES);
export type AepTextAlign = z.infer<typeof aepTextAlignSchema>;

// Walks the parsed-JSON-shape and rewrites any text layer's
// `style.align: "justify"` to `"justify-last-left"` in place on a clone.
// Idempotent — callers can pre-pass without side effects on the source.
export function coerceLegacyTextAlign<T>(input: T): T {
  if (input == null || typeof input !== "object") return input;
  const root = input as Record<string, unknown>;
  const layers = root.layers;
  if (!Array.isArray(layers)) return input;

  const cloned: Record<string, unknown> = { ...root, layers: [...layers] };
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i];
    if (
      !layer ||
      typeof layer !== "object" ||
      (layer as { kind?: string }).kind !== "text"
    ) {
      continue;
    }
    const style = (layer as { style?: { align?: unknown } }).style;
    if (style && style.align === "justify") {
      const newStyle = { ...style, align: "justify-last-left" };
      (cloned.layers as unknown[])[i] = { ...layer, style: newStyle };
    }
  }
  return cloned as T;
}

// Validates a candidate run array against a source string. Returns
// either { ok: true, runs } where runs cover [0, sourceLength) without
// overlap (gaps filled with empty-style runs), or { ok: false, error }.
export interface TextRunsValidationResult {
  runs: AepTextStyleRun[];
  warnings: string[];
}

export class TextRunsOverlapError extends Error {
  constructor(public readonly ranges: Array<[number, number, number, number]>) {
    super(
      `text runs overlap: ${ranges
        .map(([a0, a1, b0, b1]) => `[${a0},${a1}) ∩ [${b0},${b1})`)
        .join(", ")}`,
    );
    this.name = "TextRunsOverlapError";
  }
}

// Normalizes a user-declared run array to fully cover [0, sourceLength).
// - Sorts by `from`.
// - Throws on overlap.
// - Inserts implicit empty-style runs in the gaps.
// - Clips runs whose `to > sourceLength` to the source length (skip
//   entirely if `from >= sourceLength`).
export function normalizeTextRuns(
  runs: ReadonlyArray<AepTextStyleRun>,
  sourceLength: number,
): TextRunsValidationResult {
  const warnings: string[] = [];
  if (sourceLength <= 0) {
    return { runs: [], warnings };
  }

  const sorted = [...runs].sort((a, b) => a.from - b.from);
  const overlaps: Array<[number, number, number, number]> = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    if (curr.from < prev.to) {
      overlaps.push([prev.from, prev.to, curr.from, curr.to]);
    }
  }
  if (overlaps.length > 0) {
    throw new TextRunsOverlapError(overlaps);
  }

  const clipped: AepTextStyleRun[] = [];
  for (const r of sorted) {
    if (r.from >= sourceLength) continue;
    if (r.to <= 0) continue;
    if (r.to > sourceLength) {
      warnings.push(
        `run [${r.from},${r.to}) clipped to source length ${sourceLength}`,
      );
      clipped.push({ ...r, to: sourceLength });
    } else {
      clipped.push(r);
    }
  }

  // Fill gaps with empty-style runs.
  const out: AepTextStyleRun[] = [];
  let cursor = 0;
  for (const r of clipped) {
    if (r.from > cursor) {
      out.push({ from: cursor, to: r.from });
    }
    out.push(r);
    cursor = r.to;
  }
  if (cursor < sourceLength) {
    out.push({ from: cursor, to: sourceLength });
  }

  return { runs: out, warnings };
}
