// Owned by S8b. Rejects an oversized new-film upload before it reaches the handler.
import type { MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { getLimits } from './limits-config';

export function createUploadLimit(opts: { maxMb?: number } = {}): MiddlewareHandler {
  let limit: MiddlewareHandler | undefined;
  return async (c, next) => {
    if (c.req.method !== 'POST' || c.req.path !== '/api/films') return next();
    const maxMb = opts.maxMb ?? getLimits().maxUploadMb;
    limit ??= bodyLimit({ maxSize: maxMb * 1024 * 1024, onError: (ctx) => ctx.json({ error: 'payload_too_large', maxMb }, 413) });
    return limit(c, next);
  };
}
