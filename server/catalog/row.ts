// Owned by Catalog Crew C1. One catalogue row's whole build: the product, its cut-out, the plate
// and the copy, turned into a clip and a verdict. Pure: it calls no model, no art and no network,
// so the first build and every later price edit share it and cost nothing.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { PlateMap } from '@engine/qa';
import type { RowCheck } from '@shared/catalog-run';
import type { CinematicBoard } from '../authoring/beatsheet';
import type { ClipAsset } from '../authoring/retail-clip';
import { buildCatalogClip, type CatalogClipInput } from '../authoring/catalog-clip';
import type { Comp } from '../authoring/types';
import { verifyRetailClip } from '../authoring/verify-clip';

/** The stored pictures of a film's set. */
export interface SetArt {
  backdrop: ClipAsset;
  dot?: ClipAsset;
  ground: string;
}

/** A plate id becomes a file name, so it may not point out of the fixtures folder. */
export const PLATE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** The part of a plate's read the verifier needs: where its surfaces are, how busy it is, what holds each quadrant. */
export type PlateRead = Pick<PlateMap, 'surfaces' | 'busy' | 'quadrants'>;

/**
 * The exact input a row is built from, stored next to its clip: a price edit reads it back and
 * builds again, with no art and no model. `plateMap` is the plate's read (fixtures/plates/<id>.json),
 * kept beside the plate asset because it is a fixture of the plate, not the plate itself.
 */
export type RowBuild = CatalogClipInput & {
  /** The base line as a fraction of the frame height. The verifier's fixer sets it. */
  baseY?: number;
  /** The plate's read, as JSON. It comes off the disk, so it is not trusted to have a shape. */
  plateMap?: unknown;
  /** The hero film's board, once Muse (or the floor) wrote it: a price edit plays it again at $0. */
  film?: CinematicBoard;
  /** The pictures of the film's set, drawn once the board named its look: the backdrop, the bokeh dot and the floor colour. */
  setArt?: SetArt;
};

/** Where a row ends once its clip is built: it passed, the fixer had to move it, or it still blocks. */
export type RowVerdict = 'ready' | 'fixed' | 'flagged';

export interface RowResult {
  /** The clip to save. */
  comp: Comp;
  /** What the verifier said, or null when nothing checked it (the 3D hero has no plate to read). */
  check: RowCheck | null;
  status: RowVerdict;
  /** The build the clip came from: the fixer's base line, when it moved one. */
  build: RowBuild;
}

const surfaceSchema = z.object({ name: z.string(), top: z.number(), bottom: z.number(), left: z.number(), right: z.number() });
const plateReadSchema = z.object({ surfaces: z.array(surfaceSchema), busy: z.array(z.number()), quadrants: z.record(z.string(), z.string()).optional() });

/**
 * The plate's read, when the build carries one that has a shape. A build that was read back from
 * the disk holds JSON of unknown shape, so it is checked here instead of trusted.
 */
function readOf(build: RowBuild): PlateRead | undefined {
  const parsed = plateReadSchema.safeParse(build.plateMap);
  if (!parsed.success) return undefined;
  const { surfaces, busy, quadrants } = parsed.data;
  return { surfaces, busy, ...(quadrants ? { quadrants } : {}) };
}

/**
 * One row's clip and its verdict. The 3D hero is built and trusted: the verifier only knows the 2D
 * clip. Every other look is built, checked and fixed by the placement verifier, and what it says
 * becomes the row's check — never invented, always what `verifyRetailClip` returned.
 */
export function buildRow(build: RowBuild): RowResult {
  if (build.look === 'hero-3d') return { comp: buildCatalogClip(build), check: null, status: 'ready', build };

  const read = readOf(build);
  const plate = build.plate ? { ...build.plate, ...(read ? { map: read } : {}) } : undefined;
  const result = verifyRetailClip({
    aspect: build.aspect,
    look: build.look,
    ...(plate ? { plate } : {}),
    product: build.product,
    title: build.title,
    price: build.price,
    ...(build.wasPrice !== undefined ? { wasPrice: build.wasPrice } : {}),
    ...(build.currency ? { currency: build.currency } : {}),
    ...(build.brand ? { brand: build.brand } : {}),
    accent: build.accent,
    ...(build.baseY !== undefined ? { baseY: build.baseY } : {}),
  });

  const last = result.rounds.at(-1)!;
  const check: RowCheck = {
    ok: result.ok,
    rounds: result.rounds.length,
    // what the fixer moved, in the order it moved it
    applied: result.rounds.flatMap((round) => round.applied),
    // the groups that still block the clip, and the ones that do not but are worth saying
    blocking: last.groups.map((g) => `${g.kind} ${g.subject}`),
    warnings: last.warnings.slice(0, 5).map((g) => `${g.kind} ${g.subject}`),
  };
  const status: RowVerdict = !result.ok ? 'flagged' : result.rounds.length > 1 ? 'fixed' : 'ready';

  // the fixer works on the input, so the build it hands back carries the base line the clip used
  const out: RowBuild = { ...build };
  if (result.input.baseY !== undefined) out.baseY = result.input.baseY;
  return { comp: result.comp, check, status, build: out };
}

/**
 * The read of a plate that has one recorded: its surfaces, busy grid and quadrants. Undefined when
 * the plate has no read (most plates do not), so the verifier then checks the frame rules alone.
 */
export function loadPlateMap(plateId: string, root = process.cwd()): PlateRead | undefined {
  if (!PLATE_ID_RE.test(plateId)) throw new RangeError(`not a plate id: ${plateId}`);
  const file = join(root, 'fixtures', 'plates', `${plateId}.json`);
  if (!existsSync(file)) return undefined;
  return plateReadSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
}
