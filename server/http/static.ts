import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import type { Hono } from 'hono';
import { relative } from 'node:path';

/** Serve the built web app with an SPA fallback. /api/* keeps returning JSON 404s. No-op when the build is missing. */
export function mountStatic(app: Hono, opts: { root?: string } = {}): boolean {
  const abs = resolve(opts.root ?? 'web/dist');
  if (!existsSync(resolve(abs, 'index.html'))) {
    console.info(`static: ${abs} not found, not serving the web app (run npm run build)`);
    return false;
  }
  const html = readFileSync(resolve(abs, 'index.html'), 'utf8');
  // serveStatic wants a root relative to the working directory
  const rel = relative(process.cwd(), abs) || '.';
  app.use('*', async (c, next) => {
    if (c.req.path.startsWith('/api/')) return next();
    return serveStatic({ root: rel })(c, next);
  });
  app.get('*', (c) => (c.req.path.startsWith('/api/') ? c.json({ error: 'not_found' }, 404) : c.html(html)));
  return true;
}
