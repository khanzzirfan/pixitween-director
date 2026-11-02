// Owned by Catalog Crew C1. The one typed shape of a catalog run and its rows: the server writes it,
// the catalog.row / catalog.done events carry it and the wall reads it. Nothing here knows about art or disk.
import { z } from 'zod';
import { productSchema } from './catalog';

export const CATALOG_ID_RE = /^cat_[a-z0-9]{8,32}$/;

/** Where a row is in its life. `queued` is the start; the last four never change again. */
export const ROW_STATUSES = ['queued', 'cutting', 'building', 'checking', 'ready', 'fixed', 'flagged', 'failed'] as const;
export const rowStatusSchema = z.enum(ROW_STATUSES);
export type RowStatus = z.infer<typeof rowStatusSchema>;

/** The statuses a row never leaves: the clip is saved, the check is final, the wall can count it. */
export const FINAL_ROW_STATUSES = ['ready', 'fixed', 'flagged', 'failed'] as const;
export type FinalRowStatus = (typeof FINAL_ROW_STATUSES)[number];

/** A qa kind and the layer it is about, e.g. `NOT_CONTAINED caption_price`. */
const findingSchema = z.string().regex(/^[A-Z][A-Z0-9_]* .+$/);

/** What the placement verifier said about a row. `null` when nothing checked it (a 3D hero row). */
export const rowCheckSchema = z.object({
  ok: z.boolean(),
  /** How many build rounds it took: 1 means it passed first time. */
  rounds: z.number().int().min(1),
  /** What the fixer moved, in words, e.g. `baseY 0.5 -> 0.7347 (...)`. */
  applied: z.array(z.string()),
  /** The groups that still block the clip. */
  blocking: z.array(findingSchema),
  /** The groups that do not block it but are worth saying. */
  warnings: z.array(findingSchema),
});
export type RowCheck = z.infer<typeof rowCheckSchema>;

export const catalogRowSchema = z.object({
  product: productSchema,
  status: rowStatusSchema,
  /** The look the row was built with, once one was picked. */
  look: z.string().optional(),
  /** Why the row is in this state, in words. */
  why: z.string().optional(),
  /** The photo's accent colour, as a hex string. */
  accent: z.string().optional(),
  /** Bumped every time the row's clip is rebuilt (a price edit bumps it too). */
  clipVersion: z.number().int().min(0).default(0),
  check: rowCheckSchema.nullable().default(null),
  /** Why the row failed, when it did. */
  error: z.string().optional(),
  /** How long the last build took, in milliseconds. */
  ms: z.number().optional(),
  /** The product's hero film, once it is cut: Muse's idea for it, who directed it, and a version bumped on every rebuild. */
  hero: z
    .object({
      concept: z.string(),
      source: z.enum(['muse', 'floor']),
      version: z.number().int().min(1),
    })
    .optional(),
});
export type CatalogRow = z.infer<typeof catalogRowSchema>;

/** A line film's id: `line-` and the line's name, so it is safe as a file name. */
export const LINE_ID_RE = /^line-[a-z0-9-]{1,48}$/;

/**
 * A line film: the products of one line (one brand, else one category) in one variant film, each
 * tumbling in on its own colour field, then a lineup end card. Built when the run ends and again
 * after a price edit of one of its products.
 */
export const lineFilmSchema = z.object({
  id: z.string().regex(LINE_ID_RE),
  /** The brand, or the category when the products carry no brand. */
  title: z.string().min(1),
  /** The end card's line. */
  tagline: z.string(),
  productIds: z.array(z.string()).min(2),
  /** Bumped every time the film is rebuilt, so the player reads it again. */
  version: z.number().int().min(1),
});
export type LineFilm = z.infer<typeof lineFilmSchema>;

/** The longest brief a run keeps, in characters. */
export const BRIEF_MAX = 600;

export const catalogRunSchema = z.object({
  id: z.string().regex(CATALOG_ID_RE),
  /** The carrier film: its ctx runs the art, its event log carries the catalog events. */
  filmId: z.string().min(1),
  aspect: z.enum(['9:16', '16:9', '1:1']),
  createdAt: z.string(),
  /** What the campaign is for, in the owner's words ("summer holiday sale, beach, surf"). Muse reads it for every product's film. */
  brief: z.string().max(BRIEF_MAX).optional(),
  state: z.enum(['running', 'done']),
  costUsd: z.number().min(0),
  rows: z.array(catalogRowSchema).min(1).max(200),
  /** The line films, once the run has ended. */
  films: z.array(lineFilmSchema).optional(),
});
export type CatalogRun = z.infer<typeof catalogRunSchema>;

/** A fresh catalog id: `cat_` plus 12 hex chars. */
export function newCatalogId(): string {
  const bytes = new Uint8Array(6);
  globalThis.crypto.getRandomValues(bytes);
  return 'cat_' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** True when the row will not change again, whatever the runner does next. */
export function isFinal(status: RowStatus): boolean {
  return (FINAL_ROW_STATUSES as readonly RowStatus[]).includes(status);
}

export interface CatalogSummary {
  total: number;
  final: number;
  ready: number;
  fixed: number;
  flagged: number;
  failed: number;
}

/** Counts the wall's header line: how many rows are done and how each one ended. */
export function summarize(rows: ReadonlyArray<{ status: RowStatus }>): CatalogSummary {
  const summary: CatalogSummary = { total: rows.length, final: 0, ready: 0, fixed: 0, flagged: 0, failed: 0 };
  for (const row of rows) {
    if (isFinal(row.status)) summary.final += 1;
    if (row.status === 'ready') summary.ready += 1;
    else if (row.status === 'fixed') summary.fixed += 1;
    else if (row.status === 'flagged') summary.flagged += 1;
    else if (row.status === 'failed') summary.failed += 1;
  }
  return summary;
}
