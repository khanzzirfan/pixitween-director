import type { MetaClients } from '@shared/ports';
import type { Env } from '../env';
import { createMetaHttp } from './http';
import { createImageClient } from './image';
import { createSamClient } from './sam';
import { createSparkClient } from './spark';
import { createTranscribeClient } from './transcribe';

export function createMetaClients(env: Env): MetaClients {
  const http = createMetaHttp({
    baseUrl: env.META_BASE_URL,
    apiKey: () => env.metaApiKey,
    maxInflight: env.META_MAX_INFLIGHT,
    log: (line) => console.log(line),
    mode: env.DIRECTOR_REPLAY ? { replay: { dir: env.DIRECTOR_FIXTURES_DIR } } : env.DIRECTOR_RECORD ? { record: { dir: env.DIRECTOR_FIXTURES_DIR } } : undefined,
  });
  return {
    spark: createSparkClient(http, { model: env.META_SPARK_MODEL }),
    image: createImageClient(http),
    sam: createSamClient(http),
    transcribe: createTranscribeClient(http),
  };
}
