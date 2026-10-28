// Owned by S7a (PRD prd-s07a-clippy-client). S2 stub: replace the body, keep the export names.
import type { Hono } from 'hono';
import type { AppDeps } from '../deps';

export const STUB_OWNER = 'S7a' as const;

export function registerGenerateRoutes(app: Hono, _deps: AppDeps): void {
  app.post('/api/films/:id/scenes/:sceneId/mode', (c) => c.json({ error: 'not_implemented', owner: STUB_OWNER }, 501));
  app.post('/api/films/:id/scenes/:sceneId/approve', (c) => c.json({ error: 'not_implemented', owner: STUB_OWNER }, 501));
}
