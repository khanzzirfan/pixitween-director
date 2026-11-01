import type { Hono } from 'hono';
import { isAssetId, isFilmId } from '@shared/composition';
import type { AppDeps } from './deps';
import { registerSseRoute } from './sse';

const notFound = { error: 'not_found' } as const;

export function registerReadRoutes(app: Hono, deps: AppDeps): void {
  // a take's child film is part of its parent, not a film of its own
  app.get('/api/films', async (c) => c.json((await deps.films.list()).filter((f) => !f.parentId)));

  app.get('/api/films/:id', async (c) => {
    const id = c.req.param('id');
    if (!isFilmId(id)) return c.json(notFound, 404);
    try {
      return c.json(await deps.films.get(id));
    } catch {
      return c.json(notFound, 404);
    }
  });

  app.get('/api/films/:id/versions', async (c) => {
    const id = c.req.param('id');
    if (!isFilmId(id)) return c.json(notFound, 404);
    try {
      return c.json(await deps.films.versions(id));
    } catch {
      return c.json(notFound, 404);
    }
  });

  // Unauthenticated: ids are unguessable (128-bit) and Clippy must fetch stills from here.
  app.get('/api/assets/:id', async (c) => {
    const id = c.req.param('id');
    if (!isAssetId(id)) return c.json(notFound, 404);
    try {
      const [ref, bytes] = await Promise.all([deps.assets.get(id), deps.assets.read(id)]);
      return new Response(new Uint8Array(bytes), {
        headers: {
          'Content-Type': ref.mime,
          'Content-Length': String(bytes.length),
          'Cache-Control': 'public, max-age=31536000, immutable',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    } catch {
      return c.json(notFound, 404);
    }
  });

  registerSseRoute(app, deps);
}
