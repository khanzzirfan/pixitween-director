// Owned by S14. The sequential director as a LangGraph pipeline (Phase 1 of docs/hackathon/10-langgraph-orchestration.md).
// It mirrors server/agent/director.ts step for step; the native engine stays the default until the parity gate passes.
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { ASPECT_SIZES, type FilmState } from '@shared/composition';
import type { LlmBackend } from '@shared/ports';
import type { Storyboard } from '@shared/storyboard';
import type { ToolCtx } from '@shared/tools';
import { loadEnv } from '../env';
import type { AppDeps } from '../http/deps';
import { pickBackend } from '../llm/router';
import { resizeFit } from '../media/image';
import { buildScene } from './build-scene';
import { createFakeParts, isFakeDirector } from './fake-director';
import { initFilmComposition } from './init-composition';
import { ensureSceneBasics } from './scene-basics';
import { planStoryboard } from './storyboard';

export type DirectorStatus = (value: 'planning' | 'building' | 'ready' | 'failed') => Promise<void>;

export interface DirectorGraphOpts {
  deps: AppDeps;
  film: FilmState;
  filmId: string;
  ctx: ToolCtx;
  status: DirectorStatus;
  backend?: LlmBackend;
  model?: string;
  delayMs?: number;
}

const DirectorGraphState = Annotation.Root({
  storyboard: Annotation<Storyboard | undefined>(),
  sceneCount: Annotation<number>({ reducer: (_a, b) => b ?? 0, default: () => 0 }),
  sceneIndex: Annotation<number>({ reducer: (_a, b) => b ?? 0, default: () => 0 }),
  product: Annotation<{ assetId: string; width: number; height: number } | undefined>(),
});

type DirectorGraphStateValue = typeof DirectorGraphState.State;

/**
 * plan -> init -> build (one scene per superstep, looping) -> ready.
 * There is deliberately no checkpointer: the director is a fixed one-shot pipeline, and the film store is the record.
 */
export function buildDirectorGraph(o: DirectorGraphOpts) {
  const { deps, film, filmId, ctx, status } = o;
  const fake = isFakeDirector() ? createFakeParts({ delayMs: o.delayMs }) : undefined;
  let backend: LlmBackend | undefined;

  const plan = async (): Promise<Partial<DirectorGraphStateValue>> => {
    await status('planning');
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
    return { storyboard, sceneCount: storyboard.scenes.length };
  };

  const init = async (state: DirectorGraphStateValue): Promise<Partial<DirectorGraphStateValue>> => {
    const storyboard = state.storyboard!;
    const initialized = await initFilmComposition({ ctx, film: { ...film, storyboard }, storyboard });
    await status('building');
    backend = fake?.backendFor(storyboard, initialized.product.id) ?? o.backend ?? pickBackend('build');
    const dims = ASPECT_SIZES[film.aspect];
    return {
      product: {
        assetId: initialized.product.id,
        width: initialized.product.width ?? dims.width,
        height: initialized.product.height ?? dims.height,
      },
    };
  };

  const build = async (state: DirectorGraphStateValue): Promise<Partial<DirectorGraphStateValue>> => {
    const storyboard = state.storyboard!;
    const scene = storyboard.scenes[state.sceneIndex]!;
    const dims = ASPECT_SIZES[film.aspect];
    const product = state.product!;
    const result = await buildScene({
      ctx,
      backend: backend!,
      scene,
      canvas: { ...dims, aspect: film.aspect },
      palette: storyboard.palette,
      product,
    });
    if (!result.ok || !result.calls || result.stalled)
      ctx.emit({ type: 'error', where: 'build-scene', message: `scene ${scene.id} filled with defaults` });
    await ensureSceneBasics({ ctx, scene, product: { assetId: product.assetId }, palette: storyboard.palette });
    return { sceneIndex: state.sceneIndex + 1 };
  };

  return new StateGraph(DirectorGraphState)
    .addNode('plan', plan)
    .addNode('init', init)
    .addNode('build', build)
    .addNode('ready', async () => {
      await status('ready');
      return {};
    })
    .addEdge(START, 'plan')
    .addEdge('plan', 'init')
    .addEdge('init', 'build')
    .addConditionalEdges('build', (state: DirectorGraphStateValue) => (state.sceneIndex < state.sceneCount ? 'build' : 'ready'), {
      build: 'build',
      ready: 'ready',
    })
    .addEdge('ready', END)
    .compile();
}

export async function runDirectorGraph(o: DirectorGraphOpts): Promise<void> {
  await buildDirectorGraph(o).invoke({});
}
