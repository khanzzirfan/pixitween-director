// Owned by S9. Which model answers: Spark through the API, Glimmer through Ollama (Local mode or as a fallback), or Spark Open.
import type { Buffer } from 'node:buffer';
import type { LlmBackend, MetaClients } from '@shared/ports';
import type { ToolDef } from '@shared/tools';
import type { Env } from '../env';
import { loadEnv } from '../env';
import { createMetaClients } from '../meta';
import { MetaApiError } from '../meta/http';
import { makeGlimmerBackend, type GlimmerTask } from './glimmer-backend';
import { glimmerReviewImages } from './glimmer/review';
import { getGlimmerStatus, getLocalMode } from './local-mode';
import { createSparkBackend } from './spark-backend';
import { createSparkOpenBackend } from './spark-open-backend';
import { createWonderBackend } from './wonder-backend';

export type LlmTask = 'storyboard' | 'build' | 'edit' | 'review' | 'showrunner';
export type FallbackInfo = { from: string; to: string; reason: string };
export type ReviewImages = (images: Buffer[], prompt: string, schema?: object) => Promise<unknown>;
export type Reviewer = { id: 'spark' | 'glimmer'; reviewImages: ReviewImages };

/** Tools a local edit never gets: they need new art, a generate approval or a review, and the small model guesses at them. */
export const LOCAL_EDIT_DENYLIST = ['generatePlate', 'placeProduct', 'addSubject', 'replacePlate', 'proposeGenerate', 'reviewScene', 'placeProduct3D'];

/** A reason to try Glimmer instead: the Meta API is out of credit or down, or the network failed. Other 4xx errors are our own mistakes. */
export function shouldFallback(err: unknown): boolean {
  if (err instanceof MetaApiError) return err.status === 402 || err.status >= 500;
  if (err instanceof TypeError && /fetch failed/i.test(err.message)) return true;
  const name = (err as { name?: string } | null)?.name;
  return name === 'AbortError' || name === 'TimeoutError';
}

/** Wonder is a preview model: a server error, a timeout or a 429 that survived the retries sends that one call to Spark. */
export function shouldFallbackFromWonder(err: unknown): boolean {
  if (err instanceof MetaApiError) return err.status === 429 || err.status >= 500;
  if (err instanceof TypeError && /fetch failed/i.test(err.message)) return true;
  const name = (err as { name?: string } | null)?.name;
  return name === 'AbortError' || name === 'TimeoutError';
}

const reasonOf = (err: unknown): string => (err instanceof MetaApiError ? `Meta API ${err.status}` : err instanceof Error ? err.message : String(err));

export interface RouterDeps {
  makeSpark(): LlmBackend;
  makeGlimmer(task: GlimmerTask): LlmBackend;
  /** Spark Open (Baseten), when EDIT_BACKEND asks for it. Only chat edits use it. */
  makeSparkOpen?(): LlmBackend | undefined;
  /** The showrunner's lead model. Without it, or when the configured model is a Spark model, the showrunner is Spark. */
  makeWonder?(): LlmBackend;
  showrunnerModel?(): string;
  getStatus(): Promise<{ reachable: boolean }>;
  getLocal(): boolean;
  sparkReviewer(): ReviewImages;
  glimmerReviewer(): ReviewImages;
}

type PickOpts = { local?: boolean; onFallback?: (info: FallbackInfo) => void };

export function createRouter(deps: RouterDeps) {
  const defaultWarn = (i: FallbackInfo) => console.warn(`LLM fallback ${i.from} -> ${i.to}: ${i.reason}`);

  const wantsGlimmer = (task: GlimmerTask, local: boolean | undefined): boolean => {
    if (local === false) return false;
    if (task === 'edit' || task === 'review') return local === true || (local === undefined && deps.getLocal());
    return local === true;
  };

  const withoutDenied = (inner: LlmBackend): LlmBackend => ({
    id: inner.id,
    chatWithTools: (messages, tools: ToolDef[], o) => inner.chatWithTools(messages, tools.filter((t) => !LOCAL_EDIT_DENYLIST.includes(t.name)), o),
  });

  const withFallback = (spark: LlmBackend, task: GlimmerTask, onFallback: (i: FallbackInfo) => void): LlmBackend => ({
    id: spark.id,
    async chatWithTools(messages, tools, o) {
      try {
        return await spark.chatWithTools(messages, tools, o);
      } catch (err) {
        if (!shouldFallback(err) || !(await deps.getStatus()).reachable) throw err;
        onFallback({ from: 'spark', to: 'glimmer', reason: reasonOf(err) });
        const glimmer = deps.makeGlimmer(task);
        return (task === 'edit' ? withoutDenied(glimmer) : glimmer).chatWithTools(messages, tools, o);
      }
    },
  });

  const withWonderFallback = (wonder: LlmBackend, onFallback: (i: FallbackInfo) => void): LlmBackend => ({
    id: wonder.id,
    async chatWithTools(messages, tools, o) {
      try {
        return await wonder.chatWithTools(messages, tools, o);
      } catch (err) {
        if (!shouldFallbackFromWonder(err) || o?.signal?.aborted) throw err;
        onFallback({ from: 'wonder', to: 'spark', reason: reasonOf(err) });
        return deps.makeSpark().chatWithTools(messages, tools, o);
      }
    },
  });

  function pickBackend(task: LlmTask, opts: PickOpts = {}): LlmBackend {
    if (task === 'showrunner') {
      const model = deps.showrunnerModel?.() ?? 'muse-wonder-1.0';
      if (!deps.makeWonder || model.startsWith('muse-spark')) return deps.makeSpark();
      return withWonderFallback(deps.makeWonder(), opts.onFallback ?? defaultWarn);
    }
    if (task === 'edit' && opts.local !== true) {
      const open = deps.makeSparkOpen?.();
      if (open) return open;
    }
    if (wantsGlimmer(task, opts.local)) {
      const g = deps.makeGlimmer(task);
      return task === 'edit' ? withoutDenied(g) : g;
    }
    const spark = deps.makeSpark();
    return opts.local === false ? spark : withFallback(spark, task, opts.onFallback ?? defaultWarn);
  }

  function pickReviewer(opts: PickOpts = {}): Reviewer {
    if (wantsGlimmer('review', opts.local)) return { id: 'glimmer', reviewImages: (i, p, s) => deps.glimmerReviewer()(i, p, s) };
    const spark = deps.sparkReviewer();
    if (opts.local === false) return { id: 'spark', reviewImages: spark };
    const onFallback = opts.onFallback ?? defaultWarn;
    return {
      id: 'spark',
      async reviewImages(images, prompt, schema) {
        try {
          return await spark(images, prompt, schema);
        } catch (err) {
          if (!shouldFallback(err) || !(await deps.getStatus()).reachable) throw err;
          onFallback({ from: 'spark', to: 'glimmer', reason: reasonOf(err) });
          return deps.glimmerReviewer()(images, prompt, schema);
        }
      },
    };
  }

  return { pickBackend, pickReviewer };
}

// ---- the real wiring ----
let clients: MetaClients | undefined;
let spark: LlmBackend | undefined;
let sparkOpen: LlmBackend | undefined;
let wonder: { model: string; backend: LlmBackend } | undefined;
const glimmers = new Map<GlimmerTask, LlmBackend>();
const meta = () => (clients ??= createMetaClients(loadEnv()));

const glimmerConn = (env: Pick<Env, 'GLIMMER_BASE_URL' | 'GLIMMER_MODEL'>) => ({ baseUrl: env.GLIMMER_BASE_URL, model: env.GLIMMER_MODEL });

const real = createRouter({
  makeSpark: () => (spark ??= createSparkBackend(meta().spark)),
  makeGlimmer: (task) => {
    let g = glimmers.get(task);
    if (!g) {
      const env = loadEnv();
      g = makeGlimmerBackend({ ...glimmerConn(env), task, numCtx: env.GLIMMER_NUM_CTX, skipClosingTurn: task === 'edit' });
      glimmers.set(task, g);
    }
    return g;
  },
  // EDIT_BACKEND=spark-open sends chat edits to Muse Spark Open on Baseten; storyboard, build and review stay on Spark
  makeSparkOpen: () => (loadEnv().EDIT_BACKEND === 'spark-open' ? (sparkOpen ??= createSparkOpenBackend(loadEnv())) : undefined),
  makeWonder: () => {
    const model = loadEnv().SHOWRUNNER_MODEL;
    if (wonder?.model !== model) wonder = { model, backend: createWonderBackend({ meta: meta().spark, model }) };
    return wonder.backend;
  },
  showrunnerModel: () => loadEnv().SHOWRUNNER_MODEL,
  getStatus: () => getGlimmerStatus(),
  getLocal: () => getLocalMode(),
  sparkReviewer: () => (images, prompt, schema) => meta().spark.reviewImages(images, prompt, schema),
  glimmerReviewer: () => (images, prompt, schema) => glimmerReviewImages(images, prompt, schema, glimmerConn(loadEnv())),
});

export function pickBackend(task: LlmTask, opts?: PickOpts): LlmBackend {
  return real.pickBackend(task, opts);
}

/** Frame review (S5b) must call this, so Local mode (S9) covers it. `spark` lets a caller supply its own Spark reviewer, for example the one on a film's tool context. */
export function pickReviewer(opts?: PickOpts & { spark?: ReviewImages }): Reviewer {
  if (opts?.spark) {
    const own = opts.spark;
    return createRouter({
      makeSpark: () => {
        throw new Error('not used for review');
      },
      makeGlimmer: () => {
        throw new Error('not used for review');
      },
      getStatus: () => getGlimmerStatus(),
      getLocal: () => getLocalMode(),
      sparkReviewer: () => own,
      glimmerReviewer: () => (images, prompt, schema) => glimmerReviewImages(images, prompt, schema, glimmerConn(loadEnv())),
    }).pickReviewer(opts);
  }
  return real.pickReviewer(opts);
}
