// Owned by S3b (PRD prd-s03b-director-agent). S2 stub: replace the body, keep the export names.
import type { Hono } from 'hono';
import type { AppDeps } from '../deps';

export const STUB_OWNER = 'S3b' as const;

export function registerFilmsRoutes(app: Hono, _deps: AppDeps): void {
  app.post('/api/films', (c) => c.json({ error: 'not_implemented', owner: STUB_OWNER }, 501));
}
