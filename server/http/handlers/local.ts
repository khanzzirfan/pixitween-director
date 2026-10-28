// Owned by S9 (PRD prd-s09-local-mode). S2 stub: replace the body, keep the export names.
import type { Hono } from 'hono';
import type { AppDeps } from '../deps';

export const STUB_OWNER = 'S9' as const;

export function registerLocalRoutes(app: Hono, _deps: AppDeps): void {
  app.get('/api/local-mode', (c) => c.json({ error: 'not_implemented', owner: STUB_OWNER }, 501));
  app.put('/api/local-mode', (c) => c.json({ error: 'not_implemented', owner: STUB_OWNER }, 501));
}
