import { expect, it } from 'vitest';
import { ConfigError } from './errors';
import { loadEnv } from './env';

const throwsNaming = (src: Record<string, string>, name: string) => {
  try {
    loadEnv(src);
  } catch (e) {
    expect(e).toBeInstanceOf(ConfigError);
    expect((e as Error).message).toContain(name);
    return;
  }
  throw new Error(`expected loadEnv to throw for ${name}`);
};

it('has the D-8 defaults', () => {
  expect(loadEnv({})).toMatchObject({
    PORT: 8787, PUBLIC_BASE_URL: 'http://localhost:8787', DATA_DIR: './data', GENERATE_MAX_PER_HOUR: 4, FILMS_PER_HOUR_PER_IP: 3,
    MAX_UPLOAD_MB: 25, TRUST_FLY_CLIENT_IP: false, LOCAL_MODE: false, EDIT_BACKEND: 'spark', MCP_EDIT_WAIT_MS: 45000,
    META_SPARK_MODEL: 'muse-spark-1.3-contributor', META_BASE_URL: 'https://api.meta.ai/v1', GLIMMER_BASE_URL: 'http://localhost:11434',
    GLIMMER_MODEL: 'muse-glimmer:30b-mlx', DIRECTOR_FIXTURES_DIR: 'fixtures/replay', DIRECTOR_SCENE_CONCURRENCY: 1, META_MAX_INFLIGHT: 8,
    FILMS_IN_FLIGHT_MAX: 2, FILMS_QUEUE_MAX: 4, FILMS_STARTS_PER_WINDOW: 3, FILMS_WINDOW_SEC: 300,
  });
});
it('derives PUBLIC_BASE_URL from PORT', () => expect(loadEnv({ PORT: '9000' }).PUBLIC_BASE_URL).toBe('http://localhost:9000'));
it('falls back to MODEL_API_KEY', () => {
  expect(loadEnv({ MODEL_API_KEY: 'k' }).metaApiKey).toBe('k');
  expect(loadEnv({ MODEL_API_KEY: 'k', META_API_KEY: 'm' }).metaApiKey).toBe('m');
});
it('parses booleans', () => {
  expect(loadEnv({ LOCAL_MODE: '1' }).LOCAL_MODE).toBe(true);
  expect(loadEnv({ LOCAL_MODE: 'true' }).LOCAL_MODE).toBe(true);
  expect(loadEnv({ LOCAL_MODE: '0' }).LOCAL_MODE).toBe(false);
  expect(loadEnv({ LOCAL_MODE: '' }).LOCAL_MODE).toBe(false);
});
it('names the failing variable', () => {
  throwsNaming({ EDIT_BACKEND: 'x' }, 'EDIT_BACKEND');
  throwsNaming({ PORT: 'abc' }, 'PORT');
  throwsNaming({ DIRECTOR_SCENE_CONCURRENCY: '0' }, 'DIRECTOR_SCENE_CONCURRENCY');
  throwsNaming({ DIRECTOR_SCENE_CONCURRENCY: '9' }, 'DIRECTOR_SCENE_CONCURRENCY');
  throwsNaming({ META_MAX_INFLIGHT: '17' }, 'META_MAX_INFLIGHT');
  throwsNaming({ FILMS_IN_FLIGHT_MAX: '7' }, 'FILMS_IN_FLIGHT_MAX');
  throwsNaming({ FILMS_QUEUE_MAX: '21' }, 'FILMS_QUEUE_MAX');
  throwsNaming({ FILMS_WINDOW_SEC: '10' }, 'FILMS_WINDOW_SEC');
});
it('rejects replay and record together', () => throwsNaming({ DIRECTOR_REPLAY: '1', DIRECTOR_RECORD: '1' }, 'DIRECTOR_REPLAY'));

it('treats empty values as unset, so a copied .env.example loads', () => {
  expect(loadEnv({ PORT: '', DATA_DIR: '', EDIT_BACKEND: '', META_API_KEY: '' })).toMatchObject({ PORT: 8787, DATA_DIR: './data', EDIT_BACKEND: 'spark', metaApiKey: undefined });
});

it('has crew defaults', () => {
  expect(loadEnv({})).toMatchObject({
    CREW_ENABLED: true,
    SHOWRUNNER_MODEL: 'muse-wonder-1.0',
    CREW_MAX_WORKERS: 4,
    CREW_FILM_BUDGET_USD: 1.5,
    CREW_TAKES_MAX: 3,
    CREW_INBOX_DEBOUNCE_MS: 1500,
    CREW_CAPTURE_TIMEOUT_MS: 90000,
    CREW_IDLE_END_MS: 600000,
  });
});
it('parses CREW_ENABLED=false and 0 to false, and an empty value to the default', () => {
  expect(loadEnv({ CREW_ENABLED: 'false' }).CREW_ENABLED).toBe(false);
  expect(loadEnv({ CREW_ENABLED: '0' }).CREW_ENABLED).toBe(false);
  expect(loadEnv({ CREW_ENABLED: '' }).CREW_ENABLED).toBe(true);
});
it('has PRODUCT_3D off unless it is set to 1 or true', () => {
  expect(loadEnv({}).PRODUCT_3D).toBe(false);
  expect(loadEnv({ PRODUCT_3D: '' }).PRODUCT_3D).toBe(false);
  expect(loadEnv({ PRODUCT_3D: 'true' }).PRODUCT_3D).toBe(true);
  expect(loadEnv({ PRODUCT_3D: '1' }).PRODUCT_3D).toBe(true);
  expect(loadEnv({ PRODUCT_3D: '0' }).PRODUCT_3D).toBe(false);
});
it('names the crew variable that is out of range', () => {
  throwsNaming({ CREW_MAX_WORKERS: '9' }, 'CREW_MAX_WORKERS');
  throwsNaming({ CREW_TAKES_MAX: '1' }, 'CREW_TAKES_MAX');
  throwsNaming({ CREW_FILM_BUDGET_USD: '50' }, 'CREW_FILM_BUDGET_USD');
  throwsNaming({ CREW_INBOX_DEBOUNCE_MS: '20000' }, 'CREW_INBOX_DEBOUNCE_MS');
});
