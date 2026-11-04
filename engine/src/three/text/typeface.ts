/** Metrics read from a Three typeface JSON (`*.typeface.json`). Pure: no Three, no I/O. */
export interface TypefaceMetrics {
  resolution: number;
  ascender: number;
  descender: number;
  /** True when the font has an outline/advance entry for this character. */
  has(ch: string): boolean;
  /** Horizontal advance of `ch` at `size`: `ha / resolution * size`. Space falls back to `0.3 * size`. */
  advance(ch: string, size: number): number;
}

interface RawTypeface {
  resolution?: unknown;
  ascender?: unknown;
  descender?: unknown;
  glyphs?: unknown;
}

const SPACE_FALLBACK = 0.3;

export function parseTypeface(json: unknown): TypefaceMetrics {
  const raw = (json ?? {}) as RawTypeface;
  const resolution = typeof raw.resolution === 'number' && raw.resolution > 0 ? raw.resolution : 1000;
  const ascender = typeof raw.ascender === 'number' ? raw.ascender : 0;
  const descender = typeof raw.descender === 'number' ? raw.descender : 0;
  const glyphs = (raw.glyphs && typeof raw.glyphs === 'object' ? raw.glyphs : {}) as Record<string, { ha?: unknown } | undefined>;
  const own = (ch: string) => Object.prototype.hasOwnProperty.call(glyphs, ch);
  const ha = (ch: string): number | undefined => {
    if (!own(ch)) return undefined;
    const v = glyphs[ch]?.ha;
    return typeof v === 'number' ? v : undefined;
  };

  return {
    resolution,
    ascender,
    descender,
    has: (ch) => own(ch),
    advance(ch, size) {
      const v = ha(ch);
      if (v !== undefined) return (v / resolution) * size;
      if (ch === ' ') return SPACE_FALLBACK * size;
      return 0;
    },
  };
}
