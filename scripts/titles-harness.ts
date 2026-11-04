// Titles harness: does a prompt come out as good 3D words?
//   1. Muse writes a board for the product (one paid call, about $0.005), or a saved board is loaded with --board.
//   2. It prints what Muse decided about the words: the tagline, each shot's line, and the end card's style.
//   3. The film is built from the board exactly as the pipeline builds it, then only its words are kept (the titles world over the
//      field), so no product photo, cut-out or 3D model is needed.
//   4. It checks the layout (inside the frame, no two lines on top of each other, within the prop limit) and, with --render, draws the
//      moment each line has fully arrived and the end card into a contact sheet.
//
// Usage:
//   npx tsx scripts/titles-harness.ts --title "Coffee Co. Cold Brew" --price 4.50 --brief "Cold brew in a can, smooth and bold" [--photo p.png]
//   npx tsx scripts/titles-harness.ts --board data-s-titles/harness/board.json --render [--base http://localhost:5199]
// Options: --aspect 9:16|16:9|1:1, --was <price>, --sky <0..1> (how bright the backdrop behind the words is), --out <dir>.
// --render needs a web server for the renderer (the review web server on 5199, or any vite of this repo). Muse needs META_API_KEY.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { loadEnv } from '../server/env';
import { planBoard, type CinematicBoard } from '../server/authoring/beatsheet';
import { buildCinematicFilm, type CinematicInput } from '../server/authoring/cinematic-film';
import { TITLE_PROPS_MAX, titleSpace, wordsBox, type TitleFace } from '../server/authoring/titles3d';
import { ASPECT_SIZES } from '@shared/composition';
import type { Aspect, Obj } from '../server/authoring/types';

const args = process.argv.slice(2);
const opt = (name: string): string | undefined => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
};
const flag = (name: string) => args.includes(`--${name}`);
// its own data folder (git ignores data-s*), so the harness never writes into a real one
process.env.DATA_DIR = process.env.DATA_DIR ?? 'data-s-titles';
const out = opt('out') ?? join(process.env.DATA_DIR, 'harness');
mkdirSync(out, { recursive: true });

async function board(): Promise<{ board: CinematicBoard; title: string; price?: number; was?: number }> {
  const saved = opt('board');
  if (saved) {
    const b = JSON.parse(readFileSync(saved, 'utf8')) as CinematicBoard & { harness?: { title: string; price?: number; was?: number } };
    return { board: b, title: opt('title') ?? b.harness?.title ?? 'Product', ...(b.harness?.price !== undefined ? { price: b.harness.price } : {}), ...(b.harness?.was !== undefined ? { was: b.harness.was } : {}) };
  }
  const title = opt('title');
  if (!title) throw new Error('give --title (and --brief, --price) for Muse, or --board for a saved board');
  // the keys live in .env, as for the server
  if (existsSync('.env')) process.loadEnvFile('.env');
  const env = loadEnv();
  if (!env.metaApiKey) throw new Error('META_API_KEY is required to ask Muse; use --board to replay a saved board');
  const { buildDeps } = await import('../server/main');
  const deps = await buildDeps(env);
  const film = await deps.films.create({ aspect: (opt('aspect') ?? '9:16') as Aspect, title, brief: { text: opt('brief') ?? title, productAssetId: '' }, assets: [] });
  const ctx = deps.makeToolCtx(film.id);
  const photo = opt('photo');
  console.log(`asking Muse for a board for "${title}"${photo ? ' (with its photo)' : ''}...`);
  const planned = await planBoard(ctx, { title, ...(opt('brief') ? { brief: opt('brief')! } : {}), ...(photo ? { photo: readFileSync(photo) } : {}) });
  console.log(`board by ${planned.source}${planned.violations.length ? `; broke: ${planned.violations.join('; ')}` : ''}`);
  const price = opt('price') ? Number(opt('price')) : undefined;
  const was = opt('was') ? Number(opt('was')) : undefined;
  const file = join(out, 'board.json');
  writeFileSync(file, JSON.stringify({ ...planned.board, harness: { title, ...(price !== undefined ? { price } : {}), ...(was !== undefined ? { was } : {}) } }, null, 2));
  console.log(`saved ${file} (replay it with --board ${file})`);
  return { board: planned.board, title, ...(price !== undefined ? { price } : {}), ...(was !== undefined ? { was } : {}) };
}

const pic = (id: string, w: number, h: number) => ({ id, src: `/harness/${id}.png`, width: w, height: h });

/** The film as the pipeline builds it from a board (crew/cinematic-cut.ts), on a stand-in product. */
function film(b: CinematicBoard, title: string, aspect: Aspect, price?: number, was?: number): Obj {
  const sky = opt('sky');
  const input: CinematicInput = {
    aspect,
    sheet: b.sheet,
    ...(b.tone ? { tone: b.tone } : {}),
    ...(b.key ? { key: b.key } : {}),
    texture: { ...pic('harness-label', 2048, 1024), kind: 'label' },
    shape: 'can',
    side: '#d8d4ce',
    productAspect: 2.2,
    // the backdrop's brightness behind the words picks dark or light type; --sky stands in for the drawn set
    ...(sky !== undefined && b.set ? { set: { look: b.set.look, air: 'none', backdrop: pic('harness-sky', 2048, 1024), ground: '#888888', skyLuma: Number(sky) } } : {}),
    ...(b.tagline ? { tagline: b.tagline } : {}),
    ...(b.endCard ? { endCard: b.endCard } : {}),
    ...(b.light ? { light: b.light } : {}),
    ...(b.grade ? { grade: b.grade } : {}),
    ...(b.finish ? { finish: b.finish } : {}),
    title,
    ...(price !== undefined ? { price, ...(was !== undefined ? { wasPrice: was } : {}) } : {}),
    currency: 'USD',
    accent: b.endCard?.accent ?? '#c27a3a',
    ingredients: {},
  };
  return buildCinematicFilm(input) as Obj;
}

/** Only the words: the product world and its members go, the field, letterbox and titles world stay. */
function wordsOnly(c: Obj): Obj {
  const out = structuredClone(c);
  const scene = out.precomps.cine;
  scene.layers = (scene.layers as Obj[]).filter((l) => l.id !== 'cine:world' && !(l.kind === 'prop3d' && l.stage === 'cine:world'));
  return out;
}

const main = async () => {
  const aspect = (opt('aspect') ?? '9:16') as Aspect;
  const { W, H } = { W: ASPECT_SIZES[aspect].width, H: ASPECT_SIZES[aspect].height };
  const { board: b, title, price, was } = await board();

  console.log('\nWHAT MUSE DECIDED ABOUT THE WORDS');
  console.log(`  concept: ${b.concept}`);
  console.log(`  tagline: ${b.tagline ?? '(none)'}`);
  console.log(`  end card: ${JSON.stringify(b.endCard ?? {})}  (absent fields fall back to sans, gloss, rise, pill, coin)`);
  let t = 0;
  for (const [n, beat] of b.sheet.beats.entries()) {
    console.log(`  shot ${n + 1} ${t.toFixed(2)}-${(t + beat.seconds).toFixed(2)} s ${beat.size}${beat.text ? `: "${beat.text}"` : ''}`);
    t += beat.seconds;
  }

  const comp = wordsOnly(film(b, title, aspect, price, was));
  writeFileSync(join(out, 'titles.json'), JSON.stringify(comp));
  const fps = comp.fps as number;
  const layers = comp.precomps.cine.layers as Obj[];
  const titles = layers.filter((l) => l.kind === 'prop3d' && l.stage === 'cine:titles');
  const words = titles.filter((l) => l.source.type === 'text3d');
  const { ppu } = titleSpace(W, H);
  const faceOf = (font: string): TitleFace => (font.includes('optimer') ? 'soft' : font.includes('gentilis') ? 'serif' : 'sans');

  console.log('\nTHE WORDS AS BUILT');
  const boxes = words.map((l) => {
    const box = wordsBox(l.source.text, faceOf(l.source.font), l.source.font.endsWith('bold'), l.source.size * ppu);
    const cx = W / 2 + l.position[0] * ppu;
    const cy = H / 2 - l.position[1] * ppu;
    const from = l.source.enter.atFrame / fps;
    const to = l.outPoint / fps;
    const leaves = l.source.exit ? l.source.exit.atFrame / fps : to;
    console.log(`  "${String(l.source.text).replace(/\n/g, ' / ')}" ${l.source.font.replace('font-', '')} ${l.material.metalness === 1 ? 'metal' : 'lacquer'} ${l.source.enter.style}, ${from.toFixed(2)}-${to.toFixed(2)} s, centre ${Math.round(cx)},${Math.round(cy)}, ${Math.round(box.w)}x${Math.round(box.h)} px`);
    return { l, left: cx - box.w / 2, right: cx + box.w / 2, top: cy - box.h / 2, bottom: cy + box.h / 2, from, to, leaves };
  });
  console.log(`  plates ${titles.filter((l) => String(l.id).includes('-plate-')).length}, price slab ${titles.some((l) => String(l.id).includes('-price-slab-')) ? 'yes' : 'no'}`);

  console.log('\nCHECKS');
  const problems: string[] = [];
  if (!words.length) problems.push('no words were built');
  if (titles.length > TITLE_PROPS_MAX) problems.push(`${titles.length} title props, over the limit of ${TITLE_PROPS_MAX}`);
  const edge = W * 0.03;
  for (const x of boxes) if (x.left < edge || x.right > W - edge || x.top < edge || x.bottom > H - edge) problems.push(`"${x.l.source.text}" runs past the frame's edge`);
  for (const [n, a] of boxes.entries())
    for (const z of boxes.slice(n + 1)) {
      const together = Math.min(a.to, z.to) - Math.max(a.from, z.from) > 0.1;
      const overlap = Math.min(a.right, z.right) > Math.max(a.left, z.left) && Math.min(a.bottom, z.bottom) > Math.max(a.top, z.top);
      // the price sits on its slab and the old price on it too; only lines of their own count
      if (together && overlap) problems.push(`"${a.l.source.text}" and "${z.l.source.text}" are on screen at once on top of each other`);
    }
  const said = b.sheet.beats.filter((x, n) => x.text && n < b.sheet.beats.length - 1 && x.size !== 'macro').map((x) => x.text!);
  for (const s of said) if (!words.some((l) => String(l.source.text).replace(/\n/g, ' ').toLowerCase() === s.toLowerCase())) problems.push(`the shot line "${s}" was not built`);
  console.log(problems.length ? problems.map((p) => `  FAIL ${p}`).join('\n') : '  PASS every line inside the frame, none on top of another, all of Muse\'s lines built');

  if (flag('render')) {
    const { renderKeyFrames } = await import('../server/crew/frame-review');
    const base = opt('base') ?? 'http://localhost:5199';
    const D = comp.durationInFrames / fps;
    // each line once it has arrived and before it starts to leave, and the end card's last frame
    const times = [...new Set([...boxes.map((x) => Math.max(x.from + 0.2, Math.min(x.leaves - 0.05, x.from + 0.9))), D - 0.05].map((s) => Math.round(Math.max(0, Math.min(D - 0.05, s)) * 100) / 100))].sort((a, z) => a - z);
    console.log(`\nrendering ${times.length} frames at ${base}...`);
    // a frame the renderer failed to draw comes back plain white (a busy machine does this): draw again, once, before judging
    const blank = async (b: Buffer) => (await sharp(b).stats()).channels.every((c) => c.mean > 245 && c.stdev < 3);
    let shots = await renderKeyFrames(comp, times, base, 1500);
    if ((await Promise.all(shots.map(blank))).some(Boolean)) {
      console.log('  some frames came back blank (the renderer was busy); drawing them again');
      shots = await renderKeyFrames(comp, times, base, 2500);
    }
    const stillBlank = (await Promise.all(shots.map(blank))).filter(Boolean).length;
    if (stillBlank) {
      console.log(`  FAIL ${stillBlank} frame(s) are blank: the renderer did not draw them, so the sheet proves nothing`);
      problems.push('blank frames');
    }
    const w = 300;
    const imgs = await Promise.all(shots.map((s) => sharp(s).resize(w).toBuffer()));
    const h = (await sharp(imgs[0]!).metadata()).height!;
    const label = (s: number) => Buffer.from(`<svg width="${w}" height="26"><rect width="${w}" height="26" fill="#000" opacity="0.6"/><text x="8" y="18" font-family="Helvetica" font-size="15" fill="#fff">${s.toFixed(2)} s</text></svg>`);
    const sheet = await sharp({ create: { width: w * imgs.length, height: h, channels: 3, background: '#000' } })
      .composite(imgs.flatMap((b2, n) => [{ input: b2, left: w * n, top: 0 }, { input: label(times[n]!), left: w * n, top: 0 }]))
      .jpeg({ quality: 88 })
      .toBuffer();
    const file = join(out, 'titles-sheet.jpg');
    writeFileSync(file, sheet);
    console.log(`wrote ${file}`);
  }
  process.exit(problems.length ? 1 : 0);
};

if (!existsSync('package.json')) throw new Error('run from the repo root');
main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(2);
});
