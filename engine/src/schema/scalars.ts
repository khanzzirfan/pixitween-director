import { z } from 'zod';

export const IdSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/, 'expected an id starting with a letter, up to 64 characters of letters, digits, _ or -');

export const ColorSchema = z.string().regex(/^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, 'expected #RRGGBB or #RRGGBBAA');

export const SecondsSchema = z.number().finite().min(0);

export const Vec3Schema = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);

const EASE_PATTERN = /^(none|linear|(power[1-4]|sine|expo|circ|back|elastic|bounce|quad|cubic|quart|quint)(\.(in|out|inOut))?)(\([0-9.,\s]*\))?$/;

/** The bare `cubic(x1,y1,x2,y2)` call (no `.in`/`.out`/`.inOut`) is our bezier ease, not a GSAP named one. */
const CUBIC_CALL_PATTERN = /^cubic\(([^)]*)\)$/;

/** `cubic(...)` must carry exactly 4 numbers, with x1 and x2 (the horizontal controls) in [0, 1]. */
function isValidCubicCall(value: string): boolean {
  const match = CUBIC_CALL_PATTERN.exec(value);
  if (!match) return true;
  const parts = match[1].split(',').map((part) => part.trim());
  if (parts.length !== 4 || parts.some((part) => part === '')) return false;
  const nums = parts.map(Number);
  if (nums.some((n) => !Number.isFinite(n))) return false;
  const [x1, , x2] = nums;
  return x1 >= 0 && x1 <= 1 && x2 >= 0 && x2 <= 1;
}

export const EaseSchema = z
  .string()
  .regex(EASE_PATTERN, 'expected a GSAP ease such as "power2.inOut" or "back.out(1.7)"')
  .refine(isValidCubicCall, 'cubic(x1,y1,x2,y2) expects 4 numbers, with x1 and x2 in [0, 1]')
  .default('power2.inOut');

export const ParamValueSchema = z.union([z.number(), z.string(), z.boolean()]);

export const UNIT_TARGET_KINDS = ['glyphs', 'words', 'lines'] as const;

export type UnitTargetKind = (typeof UNIT_TARGET_KINDS)[number];

/** Parses a multi-unit target such as `glyphs:title`, or returns null when the string is not one. */
export function parseUnitTarget(target: string): { kind: UnitTargetKind; id: string } | null {
  const match = /^(glyphs|words|lines):(.+)$/.exec(target);
  return match ? { kind: match[1] as UnitTargetKind, id: match[2] } : null;
}
