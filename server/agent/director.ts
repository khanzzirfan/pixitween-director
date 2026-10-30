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

interface NativeDirectorOpts {
  deps: AppDeps;
  film: FilmState;
  filmId: string;
  ctx: ToolCtx;
  status: (value: 'planning' | 'building' | 'ready' | 'failed') => Promise<void>;
  backend?: LlmBackend;
  model?: string;
  delayMs?: number;
}

/** The original hand-written pipeline. Kept behind CREW_ENGINE=native (the default). */
async function runNativeDirector(o: NativeDirectorOpts): Promise<void> {
  const { deps, film, filmId, ctx, status } = o;
  await status('planning');
  const fake = isFakeDirector() ? createFakeParts({ delayMs: o.delayMs }) : undefined;
  const planningCtx = fake ? { ...ctx, meta: fake.meta } : ctx;
  let productJpeg: Buffer | undefined;
  try {
    productJpeg = await resizeFit(await deps.assets.read(film.brief.productAssetId), 768, 'jpeg');
  } catch {
    /* photo attachment is optional */
  }
  const model = o.model ?? loadEnv().META_SPARK_MODEL;
  const storyboard = await planStoryboard({ ctx: planningCtx, film, model, productJpeg });
  await deps.films.update(filmId, { storyboard, title: storyboard.title });
  ctx.emit({ type: 'director.storyboard', storyboard });
  const initialized = await initFilmComposition({ ctx, film: { ...film, storyboard }, storyboard });
  await status('building');
  const backend = fake?.backendFor(storyboard, initialized.product.id) ?? o.backend ?? pickBackend('build');
  const dims = ASPECT_SIZES[film.aspect];
  for (const scene of storyboard.scenes) {
    const result = await buildScene({
      ctx,
      backend,
      scene,
      canvas: { ...dims, aspect: film.aspect },
      palette: storyboard.palette,
      product: {
        assetId: initialized.product.id,
        width: initialized.product.width ?? dims.width,
        height: initialized.product.height ?? dims.height,
      },
    });
    if (!result.ok || !result.calls || result.stalled)
      ctx.emit({ type: 'error', where: 'build-scene', message: `scene ${scene.id} filled with defaults` });
    await ensureSceneBasics({ ctx, scene, product: { assetId: initialized.product.id }, palette: storyboard.palette });
  }
  await status('ready');
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
        const engine = film.crewEngine ?? loadEnv().CREW_ENGINE;
        const opts = { deps, film, filmId, ctx, status, backend: o.backend, model: o.model, delayMs: o.delayMs };
        if (engine === 'langgraph') {
          const { runDirectorGraph } = await import('./director-graph');
          await runDirectorGraph(opts);
        }
        else await runNativeDirector(opts);
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
