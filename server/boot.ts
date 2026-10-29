import type { Hono } from 'hono';
import type { AppDeps } from './http/deps';
import { installFilmQueue } from './http/film-queue-install';
import { resumeGenerations } from './tools/generate';

export type BootHook = (ctx: { app: Hono; deps: AppDeps }) => void | Promise<void>;

// Empty in S2. S7b appends resumeGenerations, S8b installFilmQueue and S11 registerMcp (named shared edits of this
// file). server/main.ts runs every hook after the routes exist and before static files are mounted, and is never edited.
export const bootHooks: BootHook[] = [
  ({ deps }) => {
    // not awaited: a clip can take 15 minutes and the server must start listening meanwhile
    void resumeGenerations(deps.makeToolCtx);
  },
  installFilmQueue,
];
