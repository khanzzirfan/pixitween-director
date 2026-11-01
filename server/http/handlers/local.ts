// Owned by S9. Reads and switches Local mode (chat edits and frame review on Muse Glimmer through Ollama).
import type { Hono } from 'hono';
import { z } from 'zod';
import type { LocalModeStatus } from '../../llm/local-mode';
import { getGlimmerStatus, getLocalMode, setLocalMode } from '../../llm/local-mode';
import type { AppDeps } from '../deps';

const bodySchema = z.object({ local: z.boolean() });

export function registerLocalRoutes(app: Hono, _deps: AppDeps, opts: { getStatus?: typeof getGlimmerStatus } = {}): void {
  const status = opts.getStatus ?? getGlimmerStatus;
  const view = (s: LocalModeStatus) => ({ local: getLocalMode(), ...s });

  app.get('/api/local-mode', async (c) => c.json(view(await status())));

  app.put('/api/local-mode', async (c) => {
    const body = bodySchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'invalid_body' }, 400);
    if (!body.data.local) {
      setLocalMode(false);
      return c.json(view(await status()));
    }
    // turning it on needs a fresh answer, not a 60 s old one
    const s = await status({ forceRefresh: true });
    if (!s.reachable) return c.json({ error: 'glimmer_unreachable', message: `Ollama is not reachable at ${s.host}. Start it with \`ollama serve\`.` }, 409);
    if (!s.modelPresent) return c.json({ error: 'glimmer_model_missing', message: `Model not found. Pull it with \`ollama pull ${s.model}\`.` }, 409);
    setLocalMode(true);
    return c.json(view(s));
  });
}
