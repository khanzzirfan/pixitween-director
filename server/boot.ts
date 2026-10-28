import type { Hono } from 'hono';
import type { AppDeps } from './http/deps';

export type BootHook = (ctx: { app: Hono; deps: AppDeps }) => void | Promise<void>;

// Empty in S2. S7b appends resumeGenerations, S8b installFilmQueue and S11 registerMcp (named shared edits of this
// file). server/main.ts runs every hook after the routes exist and before static files are mounted, and is never edited.
export const bootHooks: BootHook[] = [];
