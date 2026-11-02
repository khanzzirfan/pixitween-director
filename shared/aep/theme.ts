// Ported from the upstream AEP schema (types/aep/theme.ts, MIT).
import { z } from "zod";
import { aepAnimatableOf, type AepAnimatable, type AepKeyframe } from "./transform";

// aep-29: Color Controls / dynamic theming.
//
// Any color field that accepts an `AepThemableColor` can carry either a
// literal hex string or a `{ themeKey, default }` reference. At render
// time the `theme` map on `AepCompositionJson` (or the `theme` prop on
// `<AepComposition>`) resolves the key — falling back to `default` when
// the key is absent.
//
// The Bodymovin importer (Phase B) reads expression strings such as
// `comp("X").layer("Color Controls").effect("Primary")("Color")` and
// rewrites them as theme refs keyed by the effect name. Hand-authored
// fixtures use the same shape directly.

const aepHexColorSchema = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, "expected #RRGGBB or #RRGGBBAA");

export const aepThemeRefSchema = z
  .object({
    themeKey: z.string().min(1),
    default: aepHexColorSchema,
  })
  .strict();
export type AepThemeRef = z.infer<typeof aepThemeRefSchema>;

// A single color value — either a hex literal or a theme-keyed reference.
export const aepThemableColorValueSchema = z.union([
  aepHexColorSchema,
  aepThemeRefSchema,
]);
export type AepThemableColorValue = z.infer<typeof aepThemableColorValueSchema>;

// The animatable form used in layer fills/strokes. Each keyframe's value
// can itself be a hex literal or a theme ref — the resolver flattens to
// hex strings before the color sampler sees them.
export const aepThemableColorSchema = aepAnimatableOf(
  aepThemableColorValueSchema,
);
export type AepThemableColor = z.infer<typeof aepThemableColorSchema>;

export const aepThemeMapSchema = z.record(z.string(), aepHexColorSchema);
export type AepThemeMap = z.infer<typeof aepThemeMapSchema>;

// Resolve a themable color value (literal or ref) against a theme map.
// Falls back to `ref.default` when the key is missing, then to a generic
// "#000000" as a last resort.
export function resolveThemedColorValue(
  value: AepThemableColorValue,
  theme: AepThemeMap | undefined,
): string {
  if (typeof value === "string") return value;
  return theme?.[value.themeKey] ?? value.default;
}

// Flatten an animatable themable color to a plain `AepAnimatable<string>`,
// suitable for `sampleColor`. Keyframe array structure preserved; only
// each keyframe's `v` is resolved against the theme map.
export function flattenThemableColor(
  field: AepThemableColor | undefined,
  theme: AepThemeMap | undefined,
): AepAnimatable<string> | undefined {
  if (field === undefined) return undefined;
  if (typeof field === "string") return field;
  if (!Array.isArray(field)) return resolveThemedColorValue(field, theme);
  return field.map(
    (kf): AepKeyframe<string> => ({
      t: kf.t,
      v: resolveThemedColorValue(kf.v as AepThemableColorValue, theme),
      easeIn: kf.easeIn,
      easeOut: kf.easeOut,
      hold: kf.hold,
    }),
  );
}
