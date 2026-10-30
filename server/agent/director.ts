import type { FilmState } from '@shared/composition';
import { ASPECT_SIZES } from '@shared/composition';
import type { LlmBackend } from '@shared/ports';
import type { ToolCtx } from '@shared/tools';
import { loadEnv } from '../env';
import type { AppDeps } from '../http/deps';
import { pickBackend } from '../llm/router';
import { resizeFit } from '../media/image';
import { buildScene } from './build-scene';
import { createFakeParts, isFakeDirector } from './fake-director';
import { initFilmComposition } from './init-composition';
import { ensureSceneBasics } from './scene-basics';
import { planStoryboard, StoryboardError } from './storyboard';

export const STUB_OWNER = 'S3b' as const;
let bound: ReturnType<typeof createDirector> | undefined;

export function bindDirector(deps: AppDeps): void {
  bound = createDirector(deps);
}

export function createDirector(deps: AppDeps, o: { backend?: LlmBackend; model?: string; delayMs?: number } = {}) {
  const running = new Set<string>();
  return {
    isRunning(filmId: string) {
      return running.has(filmId);
    },
    async runDirector(filmId: string): Promise<void> {
      if (running.has(filmId)) return;
      running.add(filmId);
      const ctx = deps.makeToolCtx(filmId);
      const status = async (value: 'planning' | 'building' | 'ready' | 'failed') => {
        await deps.films.update(filmId, { status: value });
        ctx.emit({ type: 'film.status', status: value });
      };
      try {
        const film = await deps.films.get(filmId);
        const { runDirectorGraph } = await import('./director-graph');
        await runDirectorGraph({ deps, film, filmId, ctx, status, backend: o.backend, model: o.model, delayMs: o.delayMs });
      } catch (e) {
        const message = e instanceof StoryboardError ? e.message : e instanceof Error ? e.message : String(e);
        try {
          await status('failed');
        } catch {
          /* preserve original failure */
        }
        ctx.emit({ type: 'error', where: 'director', message });
      } finally {
        running.delete(filmId);
      }
    },
  };
}

export async function runDirector(filmId: string): Promise<void> {
  if (!bound) throw new Error('director not bound');
  return bound.runDirector(filmId);
}
