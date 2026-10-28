// Owned by S6 (PRD prd-s06-chat-edit). S2 stub: replace the body, keep the export names.
import type { Hono } from 'hono';
import type { AppDeps } from '../deps';

export const STUB_OWNER = 'S6' as const;

export function registerChatRoutes(app: Hono, _deps: AppDeps): void {
  app.post('/api/films/:id/chat', (c) => c.json({ error: 'not_implemented', owner: STUB_OWNER }, 501));
  app.post('/api/films/:id/undo', (c) => c.json({ error: 'not_implemented', owner: STUB_OWNER }, 501));
  app.post('/api/films/:id/redo', (c) => c.json({ error: 'not_implemented', owner: STUB_OWNER }, 501));
}
