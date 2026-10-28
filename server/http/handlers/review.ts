// Owned by S5b (PRD prd-s05b-review-visual). S2 stub: replace the body, keep the export names.
import type { Hono } from 'hono';
import type { AppDeps } from '../deps';

export const STUB_OWNER = 'S5b' as const;

export function registerReviewRoutes(app: Hono, _deps: AppDeps): void {
  app.post('/api/films/:id/frames', (c) => c.json({ error: 'not_implemented', owner: STUB_OWNER }, 501));
}
