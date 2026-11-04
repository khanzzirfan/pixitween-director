import type { Buffer } from 'node:buffer';
import sharp from 'sharp';
import { z } from 'zod';
import { PLATE_GRID, type PlateMap, type Quadrant } from '@engine/qa';
import type { ReviewImages } from '../llm/router';

// The plate read: what the critic and the placer know about a plate, as JSON, made once when the plate is made.
// Pixels give what code measures well: a PLATE_GRID x PLATE_GRID busy grid and the rows where a straight
// horizontal edge runs across the plate (a table's back or front edge, a plinth top, the wall-floor line).
// A vision model gives what code cannot: which edges belong to one surface, and what each quadrant holds.
// Its rough y values are snapped to the measured edges, so the line is exact and the meaning is the model's.

/** Analysis size: small enough to be fast, big enough that a 12x12 cell holds 15x26 pixels. */
const AW = 180;
const AH = 320;
/** Mean gradient (0-255 grey) that counts as fully busy. */
const BUSY_FULL = 25;
/** A model's y is snapped to a measured edge only when one is this close (plate fraction). */
export const SNAP = 0.05;

export interface PlatePixels {
  busy: number[];
  /** Horizontal edges, strongest first: y as a plate fraction, strength as mean grey step. */
  edges: Array<{ y: number; strength: number }>;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

export async function platePixels(image: Buffer): Promise<PlatePixels> {
  const g = await sharp(image).resize(AW, AH, { fit: 'fill' }).greyscale().raw().toBuffer();
  const px = (x: number, y: number) => g[y * AW + x]!;

  const busy: number[] = [];
  for (let r = 0; r < PLATE_GRID; r++) {
    for (let c = 0; c < PLATE_GRID; c++) {
      let e = 0;
      let n = 0;
      for (let y = Math.max(1, Math.floor((r * AH) / PLATE_GRID)); y < Math.min(AH - 1, Math.floor(((r + 1) * AH) / PLATE_GRID)); y++) {
        for (let x = Math.max(1, Math.floor((c * AW) / PLATE_GRID)); x < Math.min(AW - 1, Math.floor(((c + 1) * AW) / PLATE_GRID)); x++) {
          e += Math.abs(px(x + 1, y) - px(x - 1, y)) + Math.abs(px(x, y + 1) - px(x, y - 1));
          n++;
        }
      }
      busy.push(Math.round(Math.min(1, e / Math.max(1, n) / BUSY_FULL) * 100) / 100);
    }
  }

  // A straight edge is coherent across the width: the signed step summed along a row grows, texture cancels out.
  const rows: number[] = new Array(AH).fill(0);
  const x0 = Math.round(AW * 0.15);
  const x1 = Math.round(AW * 0.85);
  for (let y = 2; y < AH - 2; y++) {
    let s = 0;
    for (let x = x0; x < x1; x++) s += px(x, y + 2) - px(x, y - 2);
    rows[y] = Math.abs(s / (x1 - x0));
  }
  const edges: PlatePixels['edges'] = [];
  for (let y = 5; y < AH - 5; y++) {
    const v = rows[y]!;
    if (v < 6) continue;
    let peak = true;
    for (let d = -4; d <= 4 && peak; d++) if (d !== 0 && rows[y + d]! > v) peak = false;
    if (peak) edges.push({ y: r3(y / AH), strength: Math.round(v * 10) / 10 });
  }
  edges.sort((a, b) => b.strength - a.strength);
  return { busy, edges: edges.slice(0, 8) };
}

/** The nearest measured edge to a model's y, or the model's y when none is within SNAP. Frame bottom (1) and top (0) are edges too. */
export function snapY(y: number, edges: PlatePixels['edges']): number {
  const candidates = [...edges.map((e) => e.y), 0, 1];
  let best = y;
  let dist = SNAP;
  for (const e of candidates) {
    const d = Math.abs(e - y);
    if (d <= dist) {
      best = e;
      dist = d;
    }
  }
  return r3(best);
}

const QUAD_HELP = 'Q1 is the top-right quarter, Q2 the top-left, Q3 the bottom-left, Q4 the bottom-right (a Cartesian plane with the origin at the image centre).';

export function plateReadPrompt(px: PlatePixels): string {
  return [
    'You are the set dresser for a photoreal product ad. This image is the empty set (the plate). A product will be placed standing on it, and a title and a price will be laid over it.',
    `Split the image into four quadrants: ${QUAD_HELP}`,
    'For each quadrant, say in a few words what is in it and whether it is busy (detail, highlights, objects) or calm (flat, plain).',
    'Then list every surface a product could stand on (a table top, a plinth top, a shelf, a floor). For each give its name and, as fractions of the image (0 at the top/left, 1 at the bottom/right): top = the y of its back edge (where it meets the wall or background), bottom = the y of its front edge (1 if it runs off the bottom of the image), left and right = the x span of its usable top.',
    `Edges measured in the image (y fraction, strength): ${px.edges.map((e) => `${e.y} (${e.strength})`).join(', ') || 'none'}. Use them when one matches.`,
    'Reply with JSON only: {"quadrants":{"Q1":"...","Q2":"...","Q3":"...","Q4":"..."},"surfaces":[{"name":"...","top":n,"bottom":n,"left":n,"right":n}]}',
  ].join('\n');
}

const readSchema = z.object({
  quadrants: z.record(z.string(), z.string()).default({}),
  surfaces: z
    .array(z.object({ name: z.string(), top: z.number().min(0).max(1), bottom: z.number().min(0).max(1), left: z.number().min(0).max(1), right: z.number().min(0).max(1) }))
    .default([]),
});

const QUAD = { type: 'string' } as const;
const SURFACE = {
  type: 'object',
  additionalProperties: false,
  properties: { name: { type: 'string' }, top: { type: 'number' }, bottom: { type: 'number' }, left: { type: 'number' }, right: { type: 'number' } },
  required: ['name', 'top', 'bottom', 'left', 'right'],
} as const;

/** Strict-mode friendly (Spark sends it with strict: true): every object closed, every property required. */
export const PLATE_READ_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    quadrants: { type: 'object', additionalProperties: false, properties: { Q1: QUAD, Q2: QUAD, Q3: QUAD, Q4: QUAD }, required: ['Q1', 'Q2', 'Q3', 'Q4'] },
    surfaces: { type: 'array', items: SURFACE },
  },
  required: ['quadrants', 'surfaces'],
} as const;

/**
 * Reads a plate. With a reviewer, the model names the surfaces and quadrants and code snaps each surface's edges to the
 * measured ones; a surface whose snapped band is empty is dropped. Without one (or when it fails) there are no surfaces: code
 * measures edges but cannot tell which belong to one surface (on the room plate the strongest pair is foliage and table), and a
 * wrong surface is worse than none, because the verifier then reports the plate as unread instead of passing a floating pack.
 * A failed read says why in `error`, so a billed run never passes silently as unread.
 */
export async function readPlate(image: Buffer, reviewer?: ReviewImages): Promise<PlateMap & { edges: PlatePixels['edges']; error?: string }> {
  const px = await platePixels(image);
  if (reviewer) {
    try {
      const small = await sharp(image).resize({ width: 720, height: 1280, fit: 'inside' }).jpeg({ quality: 85 }).toBuffer();
      const parsed = readSchema.safeParse(await reviewer([small], plateReadPrompt(px), PLATE_READ_JSON_SCHEMA));
      if (parsed.success) {
        const surfaces = parsed.data.surfaces
          .map((s) => ({ name: s.name, top: snapY(Math.min(s.top, s.bottom), px.edges), bottom: snapY(Math.max(s.top, s.bottom), px.edges), left: r3(Math.min(s.left, s.right)), right: r3(Math.max(s.left, s.right)) }))
          .filter((s) => s.bottom - s.top > 0.01 && s.right - s.left > 0.05);
        const quadrants: Partial<Record<Quadrant, string>> = {};
        for (const q of ['Q1', 'Q2', 'Q3', 'Q4'] as const) if (parsed.data.quadrants[q]) quadrants[q] = parsed.data.quadrants[q]!.slice(0, 120);
        return { busy: px.busy, surfaces, quadrants, source: 'vision', edges: px.edges };
      }
      return { busy: px.busy, surfaces: [], source: 'pixels', edges: px.edges, error: `reply did not match the schema: ${parsed.error.issues[0]?.message ?? ''}` };
    } catch (e) {
      // unread, and the caller is told why
      return { busy: px.busy, surfaces: [], source: 'pixels', edges: px.edges, error: e instanceof Error ? e.message : String(e) };
    }
  }
  return { busy: px.busy, surfaces: [], source: 'pixels', edges: px.edges };
}
