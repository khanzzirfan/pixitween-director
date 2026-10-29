// Manual gate MG-1: generates ONE real clip end to end with the owner's own accounts. Never run by tests.
import { createServer, type Server } from 'node:http';
import { appendFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ASSET_ID_RE } from '@shared/composition';
import { addLayer, addScene, newFilmComposition, registerAsset, type Comp } from '../../server/authoring/api';
import { createClippyClient, type ClippyClient } from '../../server/clippy/mcp';
import { loadEnv } from '../../server/env';
import { getValidator } from '../../server/engine/validate';
import { createEventBus } from '../../server/events/bus';
import { createApprovalStore } from '../../server/generate/approval';
import { createJobStore } from '../../server/generate/jobs';
import { assertPublicUrl } from '../../server/generate/public-url';
import { createRateLimiter } from '../../server/generate/rate';
import { createRunner } from '../../server/generate/runner';
import { emitStamped, makeToolCtx } from '../../server/http/deps';
import { createLedger } from '../../server/ledger';
import { probeVideo } from '../../server/media/ffmpeg';
import { createMetaClients } from '../../server/meta';
import { createAssetStore } from '../../server/store/asset-store';
import { createFilmStore } from '../../server/store/film-store';
import type { LiveScript } from './run';

export const REQUIRED_ENV = ['CLIPPY_MCP_URL', 'CLIPPY_TOKEN', 'META_API_KEY', 'PUBLIC_BASE_URL'] as const;
const SCENE = 's1';
const SEED = 'fixtures/seed';

export const describe: LiveScript['describe'] = () =>
  'Generates ONE real clip end to end: a one-scene film is built from the seed mug photos, its scene image is sent to Clippy (the image is sent to Clippy and must be reachable at PUBLIC_BASE_URL), 25 Clippy credits are reserved on a Pro account, the finished clip is placed in the film and checked for the product with SAM (about 0.05 USD). Needs CLIPPY_MCP_URL, CLIPPY_TOKEN, META_API_KEY and a public https PUBLIC_BASE_URL (the deployed server, or a tunnel to ASSET_PORT you approve). A second clip in the same run is refused.';

export const estimateUsd: LiveScript['estimateUsd'] = () => 0.06;

export const missingEnv = (env: Record<string, string | undefined>): string[] => REQUIRED_ENV.filter((k) => !env[k]);

export interface LiveFilm {
  composition: Comp;
  sceneId: string;
  intent: string;
  assets: Array<{ id: string; file: string; mime: string; role: 'plate' | 'product-photo' }>;
}

const PLACEHOLDER = { bg: `ast_${'1'.repeat(32)}`, product: `ast_${'2'.repeat(32)}` };

/** The fixture film: one generate scene over the cafe photo with the mug on top. Pass the real asset ids once the files are stored. */
export function buildLiveFilm(ids: { bg: string; product: string } = PLACEHOLDER): LiveFilm {
  const intent = 'Steam rises from the mug as the camera slowly pushes in';
  let c = newFilmComposition({ aspect: '16:9', title: 'Live generate check', palette: ['#111827'] });
  c = registerAsset(c, { id: ids.bg, kind: 'image', src: `/api/assets/${ids.bg}`, width: 960, height: 640 });
  c = registerAsset(c, { id: ids.product, kind: 'image', src: `/api/assets/${ids.product}`, width: 384, height: 672 });
  c = addScene(c, { id: SCENE, durationSec: 5, mode: 'generate', intent });
  c = addLayer(c, { sceneId: SCENE, role: 'bg', kind: 'image', assetId: ids.bg });
  c = addLayer(c, { sceneId: SCENE, role: 'product', kind: 'image', assetId: ids.product });
  c = addLayer(c, { sceneId: SCENE, role: 'headline', kind: 'text', text: 'Slow mornings' });
  return {
    composition: c,
    sceneId: SCENE,
    intent,
    assets: [
      { id: ids.bg, file: `${SEED}/cafe-with-mug.jpg`, mime: 'image/jpeg', role: 'plate' },
      { id: ids.product, file: `${SEED}/mug-product.png`, mime: 'image/png', role: 'product-photo' },
    ],
  };
}

export interface LiveResult {
  jobId: string;
  outcome: string;
  secondsToDone: number;
  statuses: Array<{ status: string; atSec: number }>;
  clip?: { bytes: number; width: number; height: number };
  productVisibleFrac?: number;
  compositionValid: boolean;
  creditsCharged?: number;
  error?: string;
}

/** Plain text summary. It holds no URLs and no token, so it is safe to paste into a PR. */
export function renderLiveReport(r: LiveResult): string {
  const pct = r.productVisibleFrac === undefined ? 'not measured' : `${Math.round(r.productVisibleFrac * 100)}% (productVisibleFrac ${r.productVisibleFrac})`;
  return [
    `job id: ${r.jobId}`,
    `outcome: ${r.outcome}${r.error ? ` (${r.error})` : ''}`,
    `time to done: ${r.secondsToDone} s`,
    `statuses: ${r.statuses.map((s) => `${s.status} @ ${s.atSec} s`).join(', ') || '(none)'}`,
    `clip: ${r.clip ? `${r.clip.width}x${r.clip.height}, ${r.clip.bytes} bytes` : 'none'}`,
    `product visible: ${pct}`,
    `credits charged: ${r.creditsCharged ?? 'not reported'}`,
    `composition valid: ${r.compositionValid ? 'yes' : 'no'}`,
  ].join('\n');
}

/** A second animateImage call is a bug in this run, so it throws instead of spending 25 more credits. */
function oneClipOnly(client: ClippyClient): ClippyClient {
  let used = false;
  return {
    ...client,
    animateImage(args) {
      if (used) throw new Error('one clip per run');
      used = true;
      return client.animateImage(args);
    },
  };
}

async function nextIterationDir(): Promise<string> {
  const root = join('debug', 's07');
  await mkdir(root, { recursive: true });
  const n = (await readdir(root)).filter((d) => /^iteration-\d+$/.test(d)).length + 1;
  const dir = join(root, `iteration-${String(n).padStart(2, '0')}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

export const run: LiveScript['run'] = async ({ log }) => {
  const missing = missingEnv(process.env);
  if (missing.length) throw new Error(`Missing ${missing.join(', ')}. Add ${missing.length === 1 ? 'it' : 'them'} to .env, then run again.`);
  assertPublicUrl(process.env.PUBLIC_BASE_URL!);

  const env = loadEnv();
  const port = Number(process.env.ASSET_PORT ?? 8788);
  const dir = mkdtempSync(join(tmpdir(), 's07-live-'));
  const bus = createEventBus(dir);
  const assets = createAssetStore({ dir, publicBaseUrl: env.PUBLIC_BASE_URL });
  const validator = await getValidator();
  const films = createFilmStore({ dir, validator });
  const ledger = createLedger({ dir, emit: (id, e) => emitStamped(bus, id, e) });
  const meta = createMetaClients(env);
  const clippy = createClippyClient({ url: env.CLIPPY_MCP_URL!, token: env.CLIPPY_TOKEN! });

  let server: Server | undefined;
  try {
    const balance = await clippy.getCreditBalance();
    if (balance.currentBalance < 25) throw new Error(`Only ${balance.currentBalance} Clippy credits left; one clip needs 25.`);
    log(`credit balance: ${balance.currentBalance}`);

    // serve only GET /api/assets/:id so Clippy can fetch the scene image
    server = createServer((req, res) => {
      const id = /^\/api\/assets\/([^/?]+)$/.exec(req.url ?? '')?.[1];
      if (req.method !== 'GET' || !id || !ASSET_ID_RE.test(id)) {
        res.writeHead(404).end();
        return;
      }
      void assets.get(id).then(async (ref) => res.writeHead(200, { 'content-type': ref.mime }).end(await assets.read(id)), () => res.writeHead(404).end());
    });
    await new Promise<void>((resolve) => server!.listen(port, resolve));
    log(`serving assets on port ${port}; PUBLIC_BASE_URL must reach it`);

    const placeholder = buildLiveFilm();
    const stored = await Promise.all(placeholder.assets.map(async (a) => assets.put(await readFile(a.file), a.mime, { role: a.role })));
    const live = buildLiveFilm({ bg: stored[0]!.id, product: stored[1]!.id });
    const film = await films.create({ aspect: '16:9', brief: { text: live.intent, productAssetId: stored[1]!.id }, assets: stored });
    const committed = await films.commit(film.id, live.composition, 'user');
    if (!committed.ok) throw new Error('the fixture film does not validate');

    const ctx = makeToolCtx({ films, assets, meta, ledger, bus }, film.id);
    const statuses: LiveResult['statuses'] = [];
    const t0 = Date.now();
    bus.subscribe(film.id, (e) => {
      if (e.event.type === 'generate.progress') statuses.push({ status: e.event.status.replace(/^(failed:).*/, '$1 (see report)'), atSec: Math.round((Date.now() - t0) / 100) / 10 });
    });

    const approvals = createApprovalStore({ dir: () => join(dir, 'films', film.id) });
    const jobs = createJobStore({ filmsDir: join(dir, 'films') });
    const runner = createRunner({
      clippy: () => oneClipOnly(clippy), approvals, jobs, rate: createRateLimiter({ max: 1 }),
      env: { PUBLIC_BASE_URL: env.PUBLIC_BASE_URL, DATA_DIR: dir },
    });
    const approval = approvals.consume(approvals.propose(film.id, live.sceneId, 25).token, film.id, live.sceneId);
    log('submitting one clip...');
    await runner.run(ctx, { sceneId: live.sceneId, approval });
    await new Promise((r) => setTimeout(r, 200));

    const job = await jobs.get(film.id, live.sceneId);
    const clipRef = (await assets.list()).find((a) => a.role === 'clip');
    const clip = clipRef ? await probeVideo(await assets.read(clipRef.id)).then(async (p) => ({ bytes: (await assets.read(clipRef.id)).length, width: p.width, height: p.height })) : undefined;
    const final = await films.get(film.id);
    const result: LiveResult = {
      jobId: job?.jobId ?? 'none',
      outcome: job?.status ?? 'unknown',
      secondsToDone: Math.round((Date.now() - t0) / 100) / 10,
      statuses,
      clip,
      productVisibleFrac: job?.productVisibleFrac,
      compositionValid: validator.validate(final.composition).ok,
      creditsCharged: job?.creditsCharged,
      error: job?.error ? 'see report.json' : undefined,
    };
    log(renderLiveReport(result));

    const out = await nextIterationDir();
    await writeFile(join(out, 'report.json'), JSON.stringify({ ...result, error: job?.error }, null, 2));
    const docs = join('docs', 'hackathon', 'steps', 'step-07-generate-mode-mcp');
    await mkdir(docs, { recursive: true });
    await appendFile(join(docs, 'live-results.md'), `\n## ${new Date().toISOString()}\n\n\`\`\`\n${renderLiveReport(result)}\n\`\`\`\n`);
    log(`report written to ${out}/report.json`);
  } finally {
    await new Promise<void>((resolve) => {
      if (!server) return resolve();
      server.close(() => resolve());
      server.closeAllConnections();
    });
    await clippy.close();
  }
};
