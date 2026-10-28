import type { Buffer } from 'node:buffer';
import type { LlmBackend, MetaClients } from '@shared/ports';
import { loadEnv } from '../env';
import { createMetaClients } from '../meta';
import { createSparkBackend } from './spark-backend';
import { createSparkOpenBackend } from './spark-open-backend';

// S9 replaces both bodies below (Local mode, Glimmer, fallbacks). S2: Spark only.
export type LlmTask = 'storyboard' | 'build' | 'edit' | 'review';

let clients: MetaClients | undefined;
let backend: LlmBackend | undefined;
let sparkOpen: LlmBackend | undefined;
const meta = () => (clients ??= createMetaClients(loadEnv()));

export function pickBackend(
  task: LlmTask,
  _opts?: { local?: boolean; onFallback?: (info: { from: string; to: string; reason: string }) => void },
): LlmBackend {
  // EDIT_BACKEND=spark-open sends chat edits to Muse Spark Open on Baseten; storyboard, build and review stay on Spark
  if (task === 'edit' && loadEnv().EDIT_BACKEND === 'spark-open') return (sparkOpen ??= createSparkOpenBackend(loadEnv()));
  return (backend ??= createSparkBackend(meta().spark));
}

/** Frame review (S5b) must call this, so Local mode (S9) covers it. */
export function pickReviewer(_opts?: { local?: boolean }): { reviewImages(images: Buffer[], prompt: string, schema?: object): Promise<unknown> } {
  return { reviewImages: (images, prompt, schema) => meta().spark.reviewImages(images, prompt, schema) };
}
