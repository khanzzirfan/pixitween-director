import type { LlmBackend } from '@shared/ports';
import { ConfigError } from '../errors';
import type { Env } from '../env';
import { createMetaHttp } from '../meta/http';
import { createSparkClient } from '../meta/spark';
import { createSparkBackend } from './spark-backend';

export const BASETEN_BASE_URL = 'https://inference.baseten.co/v1';
// The hackathon key only works with this model, not the docs' `meta-models/muse-spark-open`.
export const SPARK_OPEN_MODEL = 'meta-models/muse-spark-open-1026';
// Muse Spark Open always reasons, and reasoning tokens count against the cap: a one-word answer used 68 tokens and a simple tool call 587.
export const SPARK_OPEN_MAX_TOKENS = 4096;

/** Muse Spark Open on Baseten. The API is OpenAI-compatible, so the Meta HTTP and Spark clients do the work. */
export function createSparkOpenBackend(env: Pick<Env, 'BASETEN_API_KEY' | 'META_MAX_INFLIGHT'>, o: { baseUrl?: string } = {}): LlmBackend {
  if (!env.BASETEN_API_KEY) throw new ConfigError('EDIT_BACKEND=spark-open needs BASETEN_API_KEY (see docs/baseten-spark-open.md)');
  const key = env.BASETEN_API_KEY;
  const http = createMetaHttp({
    baseUrl: o.baseUrl ?? BASETEN_BASE_URL,
    apiKey: () => key,
    keyName: 'BASETEN_API_KEY',
    maxInflight: env.META_MAX_INFLIGHT,
    log: (line) => console.log(line),
  });
  return createSparkBackend(createSparkClient(http, { model: SPARK_OPEN_MODEL }), { id: 'spark-open', maxTokens: SPARK_OPEN_MAX_TOKENS });
}
