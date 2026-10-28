// Owned by S7a. S7b registers the generation runner and the revert handler at boot.
import type { ToolCtx } from '@shared/tools';
import type { ConsumedApproval } from './approval';

export type PreflightResult = { ok: true } | { ok: false; status: number; error: string; retryAfterSec?: number };

export type GenerationRunner = {
  preflight(ctx: ToolCtx, sceneId: string): Promise<PreflightResult>;
  run(ctx: ToolCtx, input: { sceneId: string; approval: ConsumedApproval }): Promise<void>;
};
export type RevertHandler = (ctx: ToolCtx, sceneId: string) => Promise<void> | void;

let runner: GenerationRunner | undefined;
let revert: RevertHandler | undefined;

export const setGenerationRunner = (r: GenerationRunner | undefined): void => void (runner = r);
export const getGenerationRunner = (): GenerationRunner | undefined => runner;
export const setRevertHandler = (fn: RevertHandler | undefined): void => void (revert = fn);
export const getRevertHandler = (): RevertHandler | undefined => revert;
