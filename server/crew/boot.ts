// Owned by S12b. The crew's boot hook: mounts the crew routes, and leaves films the server stopped under honest (design.md section 7).
import type { Job } from '@shared/crew';
import type { BootHook } from '../boot';
import { loadEnv } from '../env';
import { registerCrewRoutes } from '../http/handlers/crew';
import type { AppDeps } from '../http/deps';
import { TERMINAL } from './board';
import { createCrewPersist } from './persist';

/**
 * A server restart stops every worker. For each crew film with an unfinished board: running and awaiting-frames jobs
 * fail with 'restart', queued jobs are cancelled, and the film is 'ready' if it has a composition and 'failed' if not.
 * Returns the ids of the films it changed.
 */
export async function recoverCrewFilms(deps: AppDeps): Promise<string[]> {
  const dir = deps.dataDir ?? loadEnv().DATA_DIR;
  const fixed: string[] = [];
  for (const film of await deps.films.list()) {
    if (!film.crew) continue;
    const persist = createCrewPersist(dir, film.id);
    // a board this build cannot read (written by another branch: an unknown job kind) must not stop the films after it from recovering
    const jobs = await persist.loadBoard().catch((e: unknown) => {
      console.error(`crew restart: skipped film ${film.id}, its board cannot be read:`, e instanceof Error ? e.message.split('\n')[0] : e);
      return undefined;
    });
    if (!jobs) continue;
    const open = jobs.filter((j) => !TERMINAL.includes(j.status));
    const midFilm = film.status === 'planning' || film.status === 'building';
    if (!open.length && !midFilm) continue;

    const ctx = deps.makeToolCtx(film.id);
    const now = new Date().toISOString();
    const updated: Job[] = jobs.map((j) => {
      if (TERMINAL.includes(j.status)) return j;
      const next: Job = j.status === 'queued' ? { ...j, status: 'cancelled', endedAt: now } : { ...j, status: 'failed', error: 'restart', endedAt: now };
      ctx.emit({ type: 'job.update', job: next });
      return next;
    });
    if (open.length) await persist.saveBoard(updated);
    ctx.emit({ type: 'error', where: 'crew.restart', message: `the server restarted; ${open.length} job(s) were stopped` });
    const status = film.composition ? 'ready' : 'failed';
    await deps.films.update(film.id, { status });
    ctx.emit({ type: 'film.status', status });
    fixed.push(film.id);
  }
  return fixed;
}

export const registerCrew: BootHook = async ({ app, deps }) => {
  registerCrewRoutes(app, deps);
  await recoverCrewFilms(deps).catch((e: unknown) => console.error('crew restart recovery failed:', e));
};
