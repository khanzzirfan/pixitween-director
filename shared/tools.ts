import type { z } from 'zod';
import type { FilmVersion, FilmId } from './composition';
import type { FilmEvent } from './events';
import type { AssetStore, FilmStore, Ledger, MetaClients } from './ports';

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** A FilmEvent whose `filmId` and `at` may be omitted; `ToolCtx.emit` stamps them. */
export type EmitInput = DistributiveOmit<FilmEvent, 'filmId' | 'at'> & Partial<Pick<FilmEvent, 'filmId' | 'at'>>;

export interface ToolCtx {
  filmId: FilmId;
  films: FilmStore;
  assets: AssetStore;
  meta: MetaClients;
  emit(e: EmitInput): void; // stamps `filmId` and `at` when the caller omits them
  ledger: Ledger;
  /** The `source` tools record on commit (default 'director'; S5b 'review', S6 'chat', S7b 'generate'). */
  source?: FilmVersion['source'];
  /** Set by the crew scheduler: a cancelled job stops before its next model turn or tool call. */
  signal?: AbortSignal;
  /** Set for a crew worker: the one scene its tools may touch. */
  scope?: { sceneId: string };
}

export type ToolResult = { ok: true; version?: number; data?: unknown } | { ok: false; error: string; zodIssues?: unknown };

export interface ToolDef<A = unknown> {
  name: string;
  description: string;
  params: z.ZodType<A>;
  run(ctx: ToolCtx, args: A): Promise<ToolResult>;
}
