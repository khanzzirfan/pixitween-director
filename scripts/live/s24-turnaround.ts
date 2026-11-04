// S24 live: today's single-photo body against the turnaround body, turning side by side.
//   photo -> SAM cut-out -> turnaround (Muse draws the right side and the back beside the real front; code splits, measures, checks; one Muse look)
//   -> two 3D bodies from the same photo (today's, and the real front + drawn back at the measured depth) -> both orbit at 0, 45, 90, 135, 180, 270 degrees.
// Writes debug/turnaround/<stamp>/<name>/: every drawing (sheet-N.png, views-N.jpg) and its scores (attempts.json), pass or fail; and when one passes,
// views.jpg, compare.jpg (today's body on top, the turnaround body below) and timings.json.
// The renderer needs the review web server on 5199 (the bodies carry their pictures as data URIs, so no API server is needed); data goes to data-s-review.
// Paid (one cut-out, one image draw, one Muse look, a possible redraw: about $0.05 a photo), so it prints an estimate and exits unless --yes is passed.
// Usage: npm run live -- s24-turnaround [photo.png|.jpg ...] [--base http://localhost:5199] [--yes]
//        npm run live -- s24-turnaround --from debug/turnaround/<stamp> --yes   (re-renders a saved run's views: free)
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import sharp from 'sharp';
import { cutout } from '../../server/art/cutout';
import { FOV_BASE, PRODUCT_H, SOLID, framingDistance } from '../../server/authoring/cinematic-film';
import { SURFACES } from '../../server/authoring/cinematic-rules';
import { renderKeyFrames } from '../../server/crew/frame-review';
import { composeSheet } from '../../server/crew/sheet-film/compose';
import { buildDeps } from '../../server/main';
import { newPrepareCache, prepareProduct3D, type Prepared3D } from '../../server/product3d/prepare';
import { turnaroundFor, type TurnaroundAttempt, type TurnaroundResult } from '../../server/product3d/turnaround-flow';
import type { LiveScript } from './run';

type Obj = Record<string, any>;
const FIXTURES = [
  { photo: 'fixtures/catalog/perfume/Habik-Women-Lattafa.JPEG', noun: 'perfume bottle', alsoTry: ['bottle', 'perfume'] },
  { photo: 'fixtures/catalog/yoghurt-berry.png', noun: 'yoghurt cup', alsoTry: ['cup', 'tub'] },
];
const DATA_DIR = 'data-s-review';
const DEFAULT_BASE = 'http://localhost:5199';
// 45 and 135 are the halfway turns, where two pictures always mix; 30 and 60 show how close to them one picture holds
const YAWS = [0, 30, 45, 60, 90, 135, 180, 270];

/** The photos and the renderer to use; an unknown flag is an error with a message. */
export function parseArgs(args: string[] = []): { photos: string[]; base: string; from?: string } {
  const photos: string[] = [];
  let base = DEFAULT_BASE;
  let from: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--base') base = args[++i] ?? '';
    else if (a.startsWith('--base=')) base = a.slice('--base='.length);
    else if (a === '--from') from = args[++i] ?? '';
    else if (a.startsWith('--from=')) from = a.slice('--from='.length);
    else if (a.startsWith('--')) throw new Error(`unknown flag ${a}. Use photo paths (.png, .jpg), --base <url>, --from <run folder> and --yes`);
    else if (/\.(png|jpe?g)$/i.test(a)) photos.push(a);
    else throw new Error(`cannot use '${a}': give a .png or .jpg photo`);
  }
  if (!/^https?:\/\//.test(base)) throw new Error('--base needs a url such as http://localhost:5199');
  if (from !== undefined && !from) throw new Error('--from needs a run folder such as debug/turnaround/<stamp>');
  if (from && photos.length) throw new Error('--from re-renders a saved run; it takes no photos');
  return { photos, base, ...(from ? { from } : {}) };
}

export const describe: LiveScript['describe'] = () =>
  `S24 live: builds today's single-photo 3D body and the turnaround body (the real front, a Muse-drawn back, the depth measured on a drawn side) from the same photo, and renders both turning at 0, 30, 45, 60, 90, 135, 180 and 270 degrees. Default photos: the perfume and the yoghurt tub. The renderer needs the web server on 5199; data goes to ${DATA_DIR}. Writes debug/turnaround/<stamp>/<name>/compare.jpg (today's on top). With --from <run folder> it re-renders a saved run's views for free (no model call).`;

// one draw, one Muse look and a possible redraw for a photo; the default run is two photos but each is about 0.05, so the bound is for one
export const estimateUsd: LiveScript['estimateUsd'] = (args) => (args?.some((a) => a === '--from' || a.startsWith('--from=')) ? 0 : 0.1);

const dataUri = (png: Buffer) => `data:image/png;base64,${png.toString('base64')}`;

const shell = (o: { id: string; prep: Prepared3D; textures: Obj; depthPx: number }): Obj => ({
  id: o.id,
  name: o.id,
  kind: 'prop3d',
  role: 'product',
  stage: 'spike:world',
  inPoint: 0,
  outPoint: YAWS.length,
  source: { type: 'extrude', contour: o.prep.contour, depth: Math.round(o.depthPx * 100) / 100, section: SOLID.section },
  textures: { ...o.textures, side: o.prep.side },
  size: PRODUCT_H,
  material: SURFACES.gloss,
  position: [0, 0, 0],
  rotation: [0, 0, 0],
});

/** The body turning: the camera orbits it at YAWS, one frame each, on a grey field under neutral studio light. */
function turnComp(prop: Obj, assets: Obj): Obj {
  const S = 1080;
  const d = framingDistance(0.62, FOV_BASE, PRODUCT_H);
  const ty = PRODUCT_H / 2;
  const at = (yaw: number) => [Math.round(Math.sin((yaw * Math.PI) / 180) * d * 1e4) / 1e4, ty, Math.round(Math.cos((yaw * Math.PI) / 180) * d * 1e4) / 1e4];
  return {
    version: '1.12.0', id: 'turn', name: 'turn', width: S, height: S, fps: 1, durationInFrames: YAWS.length, assets, meta: { rotationUnit: 'deg' },
    layers: [
      { kind: 'shape', id: 'spike:bg', name: 'bg', inPoint: 0, outPoint: YAWS.length, path: { kind: 'rect', size: [S, S] }, fill: '#7d7d80', transform: { position: [S / 2, S / 2], anchor: [S / 2, S / 2], scale: [1, 1], rotation: 0, opacity: 1 } },
      {
        id: 'spike:world', name: 'World', kind: 'stage3d', inPoint: 0, outPoint: YAWS.length,
        transform: { position: [S / 2, S / 2], anchor: [S / 2, S / 2], scale: [1, 1], rotation: 0, opacity: 1 },
        viewport: { width: S, height: S },
        camera: { position: YAWS.map((y, i) => ({ t: i, v: at(y), hold: true })), target: [0, ty, 0], fov: FOV_BASE },
        set: { ground: 'none', wall: false },
        style: { shading: 'pbr', exposure: 1 },
        shadow: { opacity: 0.4, softness: 0.7 },
        lights: { preset: 'studio', key: { azimuth: -30, elevation: 55, color: '#ffffff' }, rim: { intensity: 0.6 } },
      },
      prop,
    ],
  };
}

type Deps = Awaited<ReturnType<typeof buildDeps>>;

/** Today's body and the turnaround body from the same cut-out, both turning, side by side in compare.jpg. */
async function compareBodies(deps: Deps, o: { name: string; out: string; cutId: string; turn: TurnaroundResult; base: string; lap: (step: string) => void }): Promise<void> {
  const { turn } = o;
  const cache = newPrepareCache();
  const today = await prepareProduct3D(deps.assets, { cutoutAssetId: o.cutId, shape: 'other' }, cache);
  const turned = await prepareProduct3D(deps.assets, { cutoutAssetId: o.cutId, shape: 'other', back: turn.views.back, ...(turn.views.side ? { side: turn.views.side } : {}) }, cache);
  const [fw, fh] = [today.texture.width!, today.texture.height!];
  const assets: Obj = { tex_front: { type: 'image', src: dataUri(await deps.assets.read(today.texture.id)), width: fw, height: fh } };
  if (turned.back) assets.tex_back = { type: 'image', src: dataUri(await deps.assets.read(turned.back.id)), width: fw, height: fh };
  if (turned.profile) assets.tex_side = { type: 'image', src: dataUri(await deps.assets.read(turned.profile.id)), width: turned.profile.width ?? fw, height: turned.profile.height ?? fh };
  const single = turnComp(shell({ id: 'today', prep: today, textures: { front: 'tex_front' }, depthPx: Math.min(fw, fh) * SOLID.depth }), { tex_front: assets.tex_front });
  const depthPx = turn.depthShare !== undefined ? turn.depthShare * fw : Math.min(fw, fh) * SOLID.depth;
  const drawn = turnComp(shell({ id: 'turnaround', prep: turned, textures: { front: 'tex_front', ...(turned.back ? { back: 'tex_back' } : {}), ...(turned.profile ? { profile: 'tex_side' } : {}) }, depthPx }), assets);
  o.lap('bodies');
  const times = YAWS.map((_, i) => i);
  const [a, b] = await Promise.all([renderKeyFrames(single, times, o.base), renderKeyFrames(drawn, times, o.base)]);
  o.lap('renders');
  writeFileSync(join(o.out, 'compare.jpg'), await composeSheet({
    title: `${o.name}: top today's single-photo body, bottom the real front + ${turn.views.side ? 'a drawn' : 'a supplied'} back${turn.depthShare !== undefined ? `, depth ${Math.round(turn.depthShare * 100)}% of the width` : ''}`,
    panels: [...a.map((png, i) => ({ png, label: `today ${YAWS[i]} deg` })), ...b.map((png, i) => ({ png, label: `turnaround ${YAWS[i]} deg` }))],
    columns: YAWS.length,
  }));
}

/** The views a passing turnaround was made from, kept so the bodies can be rendered again with no model call (--from). */
function saveViews(out: string, turn: TurnaroundResult): void {
  writeFileSync(join(out, 'front.png'), turn.views.front);
  writeFileSync(join(out, 'back.png'), turn.views.back);
  if (turn.views.side) writeFileSync(join(out, 'side.png'), turn.views.side);
}

/** Renders the bodies of a saved run again, from its views, into a new folder beside it: free. */
async function rerender(deps: Deps, o: { from: string; base: string; log: (line: string) => void }): Promise<void> {
  const names = readdirSync(o.from).filter((n) => existsSync(join(o.from, n, 'front.png')) && existsSync(join(o.from, n, 'back.png')));
  if (!names.length) throw new Error(`no saved views in ${o.from}: a folder there needs front.png and back.png (runs from before 4 Nov 10:30 did not save them)`);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  for (const name of names) {
    const dir = join(o.from, name);
    const out = join('debug', 'turnaround', `${stamp}-rerender`, name);
    mkdirSync(out, { recursive: true });
    const read = (f: string) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f)) : undefined);
    const depthShare = (JSON.parse(readFileSync(join(dir, 'timings.json'), 'utf8')) as { depthShare?: number }).depthShare;
    const front = read('front.png')!;
    const side = read('side.png');
    const turn: TurnaroundResult = { views: { front, back: read('back.png')!, ...(side ? { side } : {}) }, ...(depthShare !== undefined ? { depthShare } : {}) };
    const cut = await deps.assets.put(front, 'image/png', { role: 'cutout' });
    let t = Date.now();
    const lap = (step: string) => { o.log(`[${name}] ${step}: ${Math.round((Date.now() - t) / 100) / 10} s`); t = Date.now(); };
    await compareBodies(deps, { name, out, cutId: cut.id, turn, base: o.base, lap });
    o.log(`[${name}] wrote ${out}`);
  }
}

export const run: LiveScript['run'] = async ({ env, log, args }) => {
  const { photos, base, from } = parseArgs(args);
  if (!from && !env.metaApiKey) throw new Error('META_API_KEY is required for s24-turnaround');
  if (!(await fetch(`${base}/stage-check.html`).then((r) => r.ok, () => false))) throw new Error(`the web server on ${base} is not running. Start it: DIRECTOR_WEB_PORT=5199 DIRECTOR_API_URL=http://localhost:8797 npx vite --config web/vite.config.ts`);
  process.env.DATA_DIR = DATA_DIR;
  process.env.TURNAROUND = '1';
  const deps = await buildDeps({ ...env, DATA_DIR, TURNAROUND: true });
  if (from) return rerender(deps, { from, base, log });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const jobs = photos.length ? photos.map((photo) => ({ photo, noun: 'product', alsoTry: [] as string[] })) : FIXTURES;
  for (const job of jobs) {
    const name = basename(job.photo, extname(job.photo)).toLowerCase();
    const out = join('debug', 'turnaround', stamp, name);
    mkdirSync(out, { recursive: true });
    const film = await deps.films.create({ aspect: '1:1', title: name, brief: { text: name, productAssetId: '' }, assets: [] });
    const ctx = deps.makeToolCtx(film.id);
    const seconds: Record<string, number> = {};
    let t = Date.now();
    const lap = (step: string) => { seconds[step] = Math.round((Date.now() - t) / 100) / 10; t = Date.now(); log(`[${name}] ${step}: ${seconds[step]} s`); };

    const photo = readFileSync(job.photo);
    const cut = await cutout(ctx, { source: photo, noun: job.noun, alsoTry: job.alsoTry, sceneId: 'turnaround' });
    lap('cut-out');
    const cutPng = await deps.assets.read(cut.cutout.id);
    // every drawing is kept, pass or fail, with the numbers code measured on it
    const attempts: Array<Record<string, unknown>> = [];
    const flatten = (png: Buffer) => sharp(png).flatten({ background: '#7d7d80' }).png().toBuffer();
    const saving: Array<Promise<void>> = [];
    const onAttempt = (a: TurnaroundAttempt) => {
      attempts.push({ n: a.n, passed: a.passed, scores: a.scores, problems: a.problems });
      writeFileSync(join(out, `sheet-${a.n}.png`), a.sheet);
      const v = a.views;
      if (v) saving.push((async () => writeFileSync(join(out, `views-${a.n}.jpg`), await composeSheet({ title: `${name}, drawing ${a.n}: ${a.passed ? 'passed' : a.problems.join('; ')}`, panels: await Promise.all([['front', v.front], ...(v.side ? [['side', v.side]] : []), ['back', v.back]].map(async ([label, png]) => ({ png: await flatten(png as Buffer), label: label as string }))), columns: 3 })))());
    };
    const turn = await turnaroundFor(ctx, { photo, cut: cutPng, what: `a ${job.noun}`, noun: job.noun, log: (line) => log(`[${name}] ${line}`), onAttempt });
    await Promise.all(saving);
    writeFileSync(join(out, 'attempts.json'), JSON.stringify(attempts, null, 2));
    for (const a of attempts) log(`[${name}] drawing ${a.n}: ${a.passed ? 'passed' : 'refused'} ${JSON.stringify(a.scores ?? {})}`);
    lap('turnaround');
    if (!turn) {
      log(`[${name}] the turnaround did not pass; nothing to compare (the drawings and their scores are in ${out})`);
      continue;
    }
    writeFileSync(join(out, 'views.jpg'), await composeSheet({ title: `${name}: the views the body is made from`, panels: await Promise.all([['front', turn.views.front], ...(turn.views.side ? [['side', turn.views.side]] : []), ['back', turn.views.back]].map(async ([label, png]) => ({ png: await flatten(png as Buffer), label: label as string }))), columns: 3 }));
    saveViews(out, turn);
    await compareBodies(deps, { name, out, cutId: cut.cutout.id, turn, base, lap });
    const cost = deps.ledger.total(film.id);
    writeFileSync(join(out, 'timings.json'), JSON.stringify({ filmId: film.id, seconds, depthShare: turn.depthShare, costUsd: cost }, null, 2));
    log(`[${name}] cost $${cost.toFixed(4)}; wrote ${out}`);
  }
};
