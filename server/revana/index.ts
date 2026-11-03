// Optional movie path. Nothing here runs unless a caller asks and REVANA_API_KEY is set.
import { createRevanaClient, type RevanaClient } from './client';
import { loadEnv, type Env } from '../env';
import { RevanaConfigError } from './errors';

export { createRevanaClient, REVANA_BASE_URL, type GenerateOptions, type RevanaClient, type RevanaClientConfig, type WaitOptions } from './client';
export { RevanaApiError, RevanaConfigError, RevanaGenerationFailedError, RevanaTimeoutError } from './errors';
export { completeMinimax, MINIMAX_M3_MODEL, motionPrompt, type ChatResult, type ChatTurn } from './chat';
export {
  assertSeedanceInput,
  filmFromStage,
  SEEDANCE_MODEL,
  seedanceBody,
  SeedanceInputError,
  type SeedanceAspect,
  type SeedanceInput,
  type SeedanceResolution,
  type StageFilm,
  type StageFilmRequest,
  type StageStill,
} from './seedance';
export type { RevanaBalance, RevanaGeneration, RevanaQuote, RevanaStatus, RevanaSubmitOptions } from './types';

/** The client when a key is configured, otherwise nothing. The Muse crew keeps working either way. */
export function revanaFromEnv(env: Env = loadEnv()): RevanaClient | undefined {
  if (!env.REVANA_API_KEY) return undefined;
  return createRevanaClient({ apiKey: env.REVANA_API_KEY, baseUrl: env.REVANA_BASE_URL });
}

/** The client, or a clear error when the movie path was asked for without a key. */
export function requireRevana(env: Env = loadEnv()): RevanaClient {
  const client = revanaFromEnv(env);
  if (!client) throw new RevanaConfigError();
  return client;
}
