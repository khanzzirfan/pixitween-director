import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { serve } from '@hono/node-server';
import type { Hono } from 'hono';
import { createDirectAdmission } from './admission';
import { bootHooks } from './boot';
import { getValidator } from './engine/validate';
import { loadEnv, type Env } from './env';
import { createEventBus } from './events/bus';
import { createApp } from './http/app';
import { emitStamped, makeToolCtx, type AppDeps } from './http/deps';
import { mountStatic } from './http/static';
import { createLedger } from './ledger';
import { createMetaClients } from './meta';
import { createAssetStore } from './store/asset-store';
import { createFilmStore } from './store/film-store';

export async function buildDeps(env: Env): Promise<AppDeps> {
  const bus = createEventBus(env.DATA_DIR);
  const assets = createAssetStore({ dir: env.DATA_DIR, publicBaseUrl: env.PUBLIC_BASE_URL, maxUploadBytes: env.MAX_UPLOAD_MB * 1024 * 1024 });
  const films = createFilmStore({ dir: env.DATA_DIR, validator: await getValidator() });
  const ledger = createLedger({ dir: env.DATA_DIR, emit: (filmId, e) => emitStamped(bus, filmId, e) });
  const meta = createMetaClients(env);
  return {
    films,
    assets,
    meta,
    ledger,
    bus,
    admission: createDirectAdmission({ maxInFlight: env.FILMS_IN_FLIGHT_MAX }),
    makeToolCtx: (filmId) => makeToolCtx({ films, assets, meta, ledger, bus }, filmId),
  };
}

/** Routes first, then boot hooks, then static files, so a hook's routes are never shadowed by the SPA fallback. */
export async function createServerApp(deps: AppDeps, opts: { staticRoot?: string } = {}): Promise<Hono> {
  const app = createApp(deps);
  for (const hook of bootHooks) await hook({ app, deps });
  mountStatic(app, { root: opts.staticRoot });
  return app;
}

export async function main(): Promise<void> {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const env = loadEnv();
  const app = await createServerApp(await buildDeps(env));
  const server = serve({ fetch: app.fetch, port: env.PORT });
  console.log(`PixiTween Director listening on http://localhost:${env.PORT}`);
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) void main();
