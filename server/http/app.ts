import { Hono } from 'hono';
import type { AppDeps } from './deps';
import { middlewares } from './middleware';
import { registerRoutes } from './routes';

/** Middlewares, a request logger, then routes. Static files are mounted by server/main.ts after the boot hooks. */
export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  for (const mw of middlewares) app.use('*', mw);
  app.use('*', async (c, next) => {
    const t0 = Date.now();
    await next();
    console.log(`${c.req.method} ${c.req.path} ${c.res.status} ${Date.now() - t0}ms`);
  });
  registerRoutes(app, deps);
  // notFound (not a catch-all route) so routes that boot hooks add later are never shadowed.
  app.notFound((c) => (c.req.path.startsWith('/api/') ? c.json({ error: 'not_found' }, 404) : c.text('Not found', 404)));
  return app;
}
