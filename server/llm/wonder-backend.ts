// Owned by S12b. Muse Wonder as the showrunner's model: the same /chat/completions path as Spark with another model name.
import type { LlmBackend, MetaClients } from '@shared/ports';
import { createSparkBackend } from './spark-backend';

export function createWonderBackend({ meta, model }: { meta: MetaClients['spark']; model: string }): LlmBackend {
  return createSparkBackend(meta, { id: 'wonder', model });
}
