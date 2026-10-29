import { z } from 'zod';
import type { Hono } from 'hono';
import { isFilmId } from '@shared/composition';
import { bindCrew, directShowrunner, getCrewSession } from '../../crew/run-crew';
import { TERMINAL } from '../../crew/board';
import type { AppDeps } from '../deps';
import { FilmBusyError, FilmNotReadyError, assertEditable, bindEditDeps, runEdit } from '../../agent/edit-loop';

export const STUB_OWNER = 'S6' as const;
const bodySchema = z.object({
  message: z.string().trim().min(1).max(2000),
  selection: z.object({ sceneId: z.string().optional(), layerId: z.string().optional() }).optional(),
  local: z.boolean().optional(),
});
export function registerChatRoutes(app: Hono, deps: AppDeps): void {
  bindEditDeps(deps);
  bindCrew(deps);
  app.post('/api/films/:id/chat', async (c) => {
    const id = c.req.param('id');
    if (!isFilmId(id)) return c.json({ error: 'not_found' }, 404);
    const parsed = bodySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'bad_message' }, 400);
    let film;
    try {
      film = await deps.films.get(id);
    } catch {
      return c.json({ error: 'not_found' }, 404);
    }
    if (film.crew) {
      // a crew film is directed through the showrunner's inbox at any time, building or not (design 3.2)
      if (film.status === 'new' || film.status === 'failed') return c.json({ error: 'film_not_ready' }, 409);
      const inboxId = await directShowrunner(deps, id, parsed.data.message, parsed.data.selection);
      return c.json({ accepted: true, inboxId }, 202);
    }
    try {
      assertEditable(film, await deps.films.versions(id));
    } catch (e) {
      if (e instanceof FilmBusyError) return c.json({ error: 'film_busy' }, 409);
      if (e instanceof FilmNotReadyError) return c.json({ error: 'film_not_ready' }, 409);
      throw e;
    }
    void runEdit(id, parsed.data.message, parsed.data.selection, { local: parsed.data.local }).catch((e) =>
      console.error(`chat edit failed for ${id}:`, e),
    );
    return c.json({ accepted: true }, 202);
  });
  for (const action of ['undo', 'redo'] as const)
    app.post(`/api/films/:id/${action}`, async (c) => {
      const id = c.req.param('id');
      if (!isFilmId(id)) return c.json({ error: 'not_found' }, 404);
      let film;
      try {
        film = await deps.films.get(id);
      } catch {
        return c.json({ error: 'not_found' }, 404);
      }
      if (film.crew) {
        const busy = getCrewSession(id)?.crew.board.list().some((j) => !TERMINAL.includes(j.status));
        if (busy) return c.json({ error: 'crew_busy' }, 409);
      } else if (film.status === 'building' || film.status === 'planning') return c.json({ error: 'film_busy' }, 409);
      const versions = await deps.films.versions(id);
      if (action === 'undo' && film.version <= 1) return c.json({ error: 'nothing_to_undo' }, 409);
      if (action === 'redo' && film.version === versions.at(-1)?.version) return c.json({ error: 'nothing_to_redo' }, 409);
      const version = await deps.films[action](id);
      deps.makeToolCtx(id).emit({ type: 'tool.call', name: action, args: {}, ok: true, version });
      return c.json({ version });
    });
}
