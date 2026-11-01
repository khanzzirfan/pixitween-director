import { readFileSync } from 'node:fs';
import type { Hono } from 'hono';
import type { HealthResponse } from '@shared/api';
import { getValidator } from '../engine/validate';
import { loadEnv } from '../env';
import { hasFfmpeg } from '../media/ffmpeg';
import type { AppDeps } from './deps';
import { registerChatRoutes } from './handlers/chat';
import { registerFilmsRoutes } from './handlers/films';
import { registerGenerateRoutes } from './handlers/generate';
import { registerLocalRoutes } from './handlers/local';
import { registerReviewRoutes } from './handlers/review';
import { registerReadRoutes } from './read-routes';

const version = (JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }).version;

// Contract D-1: later steps fill their own handler module and never edit this file.
export function registerRoutes(app: Hono, deps: AppDeps): void {
  app.get('/api/health', async (c) => {
    const env = loadEnv();
    const body: HealthResponse = {
      ok: true,
      version,
      metaConfigured: Boolean(env.metaApiKey),
      ffmpeg: await hasFfmpeg(),
      validator: (await getValidator()).name,
      replay: env.DIRECTOR_REPLAY,
    };
    return c.json(body);
  });
  registerReadRoutes(app, deps);
  registerFilmsRoutes(app, deps);
  registerChatRoutes(app, deps);
  registerReviewRoutes(app, deps);
  registerGenerateRoutes(app, deps);
  registerLocalRoutes(app, deps);
}
