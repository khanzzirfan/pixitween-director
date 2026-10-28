import { z } from 'zod';
import { ConfigError } from './errors';

const bool = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((v) => v === true || v === '1' || v === 'true');
const int = (def: number, min?: number, max?: number) => {
  let n = z.coerce.number().int();
  if (min !== undefined) n = n.min(min);
  if (max !== undefined) n = n.max(max);
  return n.default(def);
};
const optStr = z.string().optional().transform((v) => (v === '' ? undefined : v));

const schema = z.object({
  PORT: int(8787),
  PUBLIC_BASE_URL: z.string().url().optional(),
  DATA_DIR: z.string().default('./data'),
  GENERATE_MAX_PER_HOUR: int(4),
  FILMS_PER_HOUR_PER_IP: int(3),
  MAX_UPLOAD_MB: int(25),
  TRUST_FLY_CLIENT_IP: bool,
  LOCAL_MODE: bool,
  EDIT_BACKEND: z.enum(['spark', 'glimmer', 'spark-open']).default('spark'),
  BASETEN_API_KEY: optStr,
  GLIMMER_NUM_CTX: z.coerce.number().int().optional(),
  MCP_EDIT_WAIT_MS: int(45000),
  META_BASE_URL: z.string().default('https://api.meta.ai/v1'),
  META_API_KEY: optStr,
  MODEL_API_KEY: optStr,
  META_SPARK_MODEL: z.string().default('muse-spark-1.3-contributor'),
  CLIPPY_MCP_URL: optStr,
  CLIPPY_TOKEN: optStr,
  GLIMMER_BASE_URL: z.string().default('http://localhost:11434'),
  GLIMMER_MODEL: z.string().default('muse-glimmer:30b-mlx'),
  DIRECTOR_PASSCODE: optStr,
  DIRECTOR_REPLAY: bool,
  DIRECTOR_RECORD: bool,
  DIRECTOR_FIXTURES_DIR: z.string().default('fixtures/replay'),
  DIRECTOR_SCENE_CONCURRENCY: int(1, 1, 8),
  META_MAX_INFLIGHT: int(8, 1, 16),
  FILMS_IN_FLIGHT_MAX: int(2, 1, 6),
  FILMS_QUEUE_MAX: int(4, 0, 20),
  FILMS_STARTS_PER_WINDOW: int(3, 1, 50),
  FILMS_WINDOW_SEC: int(300, 30, 3600),
});

export const ENV_KEYS = Object.keys(schema.shape);

export type Env = Omit<z.infer<typeof schema>, 'PUBLIC_BASE_URL'> & {
  PUBLIC_BASE_URL: string;
  metaApiKey: string | undefined;
};

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const input: Record<string, string | undefined> = {};
  // an empty value (as copied from .env.example) means unset
  for (const k of ENV_KEYS) input[k] = source[k] === '' ? undefined : source[k];
  const r = schema.safeParse(input);
  if (!r.success) {
    const names = [...new Set(r.error.issues.map((i) => String(i.path[0])))];
    throw new ConfigError(`invalid environment: ${names.join(', ')}`);
  }
  const d = r.data;
  if (d.DIRECTOR_REPLAY && d.DIRECTOR_RECORD) throw new ConfigError('DIRECTOR_REPLAY and DIRECTOR_RECORD cannot both be set');
  return { ...d, PUBLIC_BASE_URL: d.PUBLIC_BASE_URL ?? `http://localhost:${d.PORT}`, metaApiKey: d.META_API_KEY ?? d.MODEL_API_KEY };
}
