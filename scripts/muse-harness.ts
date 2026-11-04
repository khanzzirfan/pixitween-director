// Muse harness: given a prompt, how does Muse direct the film, and is it a sound direction?
//   1. Muse writes a board for the product (one paid call, about $0.005 and 30 to 40 s), or a saved board is loaded with --board.
//   2. It prints every decision Muse made, shot by shot: how the camera moves, how the shot starts (the cut), what the product, the
//      light and the world do, the speed, the words, and the film's look (set, light, finish, end card).
//   3. It judges the direction with fixed rules (below), each one printed with what it saw. FAIL breaks the film or the brief; WARN is
//      worth a look but is Muse's call (code never overrules Muse's taste, it only checks the film plays and says something).
//   4. The board is built into the film as the pipeline builds it and the engine's validator confirms the film is playable.
//
// Usage:
//   npx tsx scripts/muse-harness.ts --title "Coffee Co. Cold Brew" --brief "Cold brew in a can, smooth and bold" --price 4.50 [--runs 3]
//   npx tsx scripts/muse-harness.ts --board data-s-muse/harness/board.json
// Options: --aspect 9:16|16:9|1:1, --category <word>, --seconds <n> (film length, default 8), --out <dir>, --photo <file>.
// --runs N asks Muse N times and tallies what it picks, to show whether it decides or falls back to the same few choices.
// Muse needs META_API_KEY (read from .env). Exit code: 0 all judged sound, 1 a FAIL, 2 the harness itself broke.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnv } from '../server/env';
import { IN_SCENE_CUTS, planBoard, reviewBoard, type Beat, type CinematicBoard } from '../server/authoring/beatsheet';
import { buildCinematicFilm, type CinematicInput } from '../server/authoring/cinematic-film';
import { CUT_SHADERS } from '../server/authoring/cinematic-rules';
import { lightValidate } from '../server/engine/light-validator';
import type { Aspect } from '../server/authoring/types';

const args = process.argv.slice(2);
const opt = (name: string): string | undefined => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
};
process.env.DATA_DIR = process.env.DATA_DIR ?? 'data-s-muse';
const out = opt('out') ?? join(process.env.DATA_DIR, 'harness');
mkdirSync(out, { recursive: true });

type Planned = { board: CinematicBoard; source: string; violations: string[] };

async function plan(runs: number): Promise<{ title: string; price?: number; aspect: Aspect; planned: Planned[] }> {
  const aspect = (opt('aspect') ?? '9:16') as Aspect;
  const saved = opt('board');
  if (saved) {
    const b = JSON.parse(readFileSync(saved, 'utf8')) as CinematicBoard & { harness?: { title: string; price?: number } };
    return { title: b.harness?.title ?? 'Product', ...(b.harness?.price !== undefined ? { price: b.harness.price } : {}), aspect, planned: [{ board: b, source: 'saved board', violations: [] }] };
  }
  const title = opt('title');
  if (!title) throw new Error('give --title (and --brief, --price) for Muse, or --board for a saved board');
  if (existsSync('.env')) process.loadEnvFile('.env');
  const env = loadEnv();
  if (!env.metaApiKey) throw new Error('META_API_KEY is required to ask Muse; use --board to replay a saved board');
  const { buildDeps } = await import('../server/main');
  const deps = await buildDeps(env);
  const price = opt('price') ? Number(opt('price')) : undefined;
  const planned: Planned[] = [];
  for (let n = 0; n < runs; n++) {
    const film = await deps.films.create({ aspect, title, brief: { text: opt('brief') ?? title, productAssetId: '' }, assets: [] });
    const ctx = deps.makeToolCtx(film.id);
    console.log(`asking Muse for a board for "${title}" (${n + 1} of ${runs})...`);
    const p = await planBoard(ctx, {
      title,
      ...(opt('brief') ? { brief: opt('brief')! } : {}),
      ...(opt('category') ? { category: opt('category')! } : {}),
      ...(opt('seconds') ? { seconds: Number(opt('seconds')) } : {}),
      ...(opt('photo') ? { photo: readFileSync(opt('photo')!) } : {}),
    });
    planned.push({ board: p.board, source: p.source, violations: p.violations });
    const file = join(out, runs > 1 ? `board-${n + 1}.json` : 'board.json');
    writeFileSync(file, JSON.stringify({ ...p.board, harness: { title, ...(price !== undefined ? { price } : {}) } }, null, 2));
    console.log(`  saved ${file} (replay it with --board ${file})`);
  }
  return { title, ...(price !== undefined ? { price } : {}), aspect, planned };
}

// ---- what Muse decided, in plain words

const pt = (p?: Record<string, unknown>): string => (p ? Object.entries(p).map(([k, v]) => `${k} ${v}`).join(', ') : '');
const camera = (c: Beat['camera']): string => {
  if (!c) return 'the move\'s own camera';
  const focus = typeof c.focus === 'string' ? c.focus : c.focus ? `focus ${c.focus.from ?? '?'}>${c.focus.to ?? '?'}` : '';
  return [c.from ? `from [${pt(c.from as never)}]` : '', c.via?.length ? `via ${c.via.length} point${c.via.length > 1 ? 's' : ''}` : '', c.to ? `to [${pt(c.to as never)}]` : '', c.ease ? `ease ${c.ease}` : '', focus, c.shake !== undefined ? `shake ${c.shake}` : ''].filter(Boolean).join('; ');
};

function describe(b: CinematicBoard): void {
  console.log(`\nTHE IDEA\n  concept: ${b.concept}\n  mood: ${b.mood}${b.tone ? `, ${b.tone} key colour` : ''}${b.key ? `, ${b.key} key` : ''}`);
  if (b.set) console.log(`  world: ${b.set.look}, air ${b.set.air}${b.set.palette ? `, painted (sky ${b.set.palette.top}, horizon ${b.set.palette.horizon}, ground ${b.set.palette.ground})` : ''}`);
  if (b.light) console.log(`  lights: key ${b.light.key}, rim ${b.light.rim}`);
  if (b.finish) console.log(`  finish: ${JSON.stringify(b.finish)}`);
  if (b.elements?.length) console.log(`  elements: ${b.elements.map((e) => `${e.id} (${e.use}, ${e.pieces ?? 1} pieces)`).join(', ')}`);
  console.log(`  words: tagline "${b.tagline ?? ''}", end card ${JSON.stringify(b.endCard ?? {})}`);
  console.log('\nTHE SHOTS');
  let t = 0;
  for (const [n, s] of b.sheet.beats.entries()) {
    const bits = [
      `${s.size} ${s.move}${s.angle ? `, ${s.angle} angle` : ''}`,
      `starts with ${s.cut ?? 'hard'} cut${s.dir ? ` (${s.dir})` : ''}`,
      `camera: ${camera(s.camera)}`,
      s.product && s.product !== 'still' ? `product ${s.product}` : '',
      s.spin ? `spin ${JSON.stringify(s.spin)}` : '',
      s.light ? `light ${JSON.stringify(s.light)}` : '',
      s.ramp ? `speed ramp ${s.ramp.map((r) => `${r.at}:${r.rate}x`).join(' ')}` : '',
      s.ingredient ? `${s.ingredient.kind} ${s.ingredient.action}${s.ingredient.place ? ` ${s.ingredient.place}` : ''}` : '',
      s.blur !== undefined ? `blur ${s.blur}` : '',
      s.text ? `says "${s.text}"` : '',
    ].filter(Boolean);
    console.log(`  ${n + 1}. ${t.toFixed(1)}-${(t + s.seconds).toFixed(1)} s${s.phase ? ` [${s.phase}]` : ''}  ${bits.join(' | ')}${s.note ? `\n       why: ${s.note}` : ''}`);
    t += s.seconds;
  }
}

// ---- the judgement

type Verdict = { level: 'PASS' | 'WARN' | 'FAIL'; rule: string; saw: string };

const CALM = /calm|premium|luxur|quiet|serene|elegan|still|gentle|slow|silk|cosy|cozy/i;
const LOUD = /energ|loud|bold|punch|fast|sport|street|party|wild|explo|electric|fierce|playful/i;
const HARD_CUTS = new Set(['whip', 'lenswhip', 'spin', 'punch', 'glitch', 'zoom']);

function judge(b: CinematicBoard, seconds: number, source: string, violations: string[]): Verdict[] {
  const v: Verdict[] = [];
  const add = (ok: boolean, rule: string, saw: string, level: 'FAIL' | 'WARN' = 'FAIL') => v.push({ level: ok ? 'PASS' : level, rule, saw });
  const beats = b.sheet.beats;
  const total = beats.reduce((a, s) => a + s.seconds, 0);

  add(source === 'muse' || source === 'saved board', 'Muse wrote the board (not the code\'s fallback)', source === 'saved board' ? 'replayed from a saved board' : `board by ${source}`);
  add(violations.length === 0, 'the board broke none of the film rules', violations.length ? violations.join('; ') : 'no violations');
  const review = reviewBoard(b);
  add(review.hard.length === 0, 'the board passes the safety review', review.hard.join('; ') || 'ok');
  add(Math.abs(total - seconds) <= 0.5, `the shots add up to the film's length (${seconds} s)`, `${total.toFixed(1)} s over ${beats.length} shots`);

  const last = beats.at(-1)!;
  add(last.move === 'hold' && last.seconds >= 1.5, 'the film ends on a hold of at least 1.5 s, where the price reads', `${last.move} for ${last.seconds} s`);
  add(beats[0]!.seconds <= 1.6, 'the hook is quick (first shot 1.6 s or less)', `first shot ${beats[0]!.seconds} s`, 'WARN');
  add(!beats[0]!.cut || beats[0]!.cut === 'hard', 'the first shot has no transition into it', `first cut: ${beats[0]!.cut ?? 'hard'}`, 'WARN');

  const cuts = beats.slice(1).map((s) => s.cut ?? 'hard');
  const shader = cuts.filter((c) => c !== 'hard' && !IN_SCENE_CUTS.includes(c as never));
  add(shader.length <= CUT_SHADERS.max, `at most ${CUT_SHADERS.max} shader cuts (each renders the world twice)`, `${shader.length}: ${shader.join(', ') || 'none'}`);
  const named = cuts.filter((c) => c !== 'hard');
  add(new Set(named).size === named.length, 'no transition used twice', named.join(', ') || 'only hard cuts');
  add(named.length >= 1, 'uses at least one designed transition', named.length ? `${named.length}` : 'all hard cuts', 'WARN');

  const moves = beats.map((s) => s.move);
  add(new Set(moves).size >= 4, 'at least 4 different camera moves', [...new Set(moves)].join(', '), 'WARN');
  add(!moves.some((m, n) => n >= 2 && m === moves[n - 1] && m === moves[n - 2]), 'no move three times in a row', moves.join(' > '), 'WARN');
  add(new Set(beats.map((s) => s.size)).size >= 3, 'at least 3 different shot sizes', beats.map((s) => s.size).join(' > '), 'WARN');

  const directed = beats.filter((s) => s.camera).length;
  add(directed >= beats.length / 2, 'Muse directs the camera itself, not just picks presets (half the shots or more)', `${directed} of ${beats.length} shots carry their own camera`, 'WARN');
  const lit = beats.filter((s) => s.light).length;
  add(lit >= 1 || !!b.light, 'the light is part of the story (a lit shot or chosen colours)', `${lit} shots direct the light${b.light ? ', colours chosen' : ''}`, 'WARN');
  const used = new Set(beats.flatMap((s) => (s.ingredient ? [s.ingredient.kind] : [])));
  const unused = (b.elements ?? []).filter((e) => !used.has(e.id)).map((e) => e.id);
  add(unused.length === 0, 'every element Muse made is used in a shot', unused.length ? `unused: ${unused.join(', ')}` : `${used.size} used`, 'WARN');
  add(beats.slice(0, -1).some((s) => s.text), 'a shot carries a line of words', `${beats.filter((s) => s.text).length} lines`, 'WARN');

  // taste, not law: a calm story with hard travelling cuts, or a loud one with only soft dissolves, may be a clash worth a look
  const mood = `${b.mood} ${b.concept}`;
  const hardCuts = named.filter((c) => HARD_CUTS.has(c));
  if (CALM.test(mood) && !LOUD.test(mood)) add(hardCuts.length === 0, 'the cuts match a calm mood', `mood "${b.mood}", energetic cuts: ${hardCuts.join(', ') || 'none'}`, 'WARN');
  else if (LOUD.test(mood) && !CALM.test(mood)) add(hardCuts.length > 0, 'the cuts match an energetic mood', `mood "${b.mood}", energetic cuts: ${hardCuts.join(', ') || 'none'}`, 'WARN');
  return v;
}

function buildFilm(b: CinematicBoard, title: string, aspect: Aspect, price?: number): { ok: boolean; saw: string } {
  const input: CinematicInput = {
    aspect,
    sheet: b.sheet,
    ...(b.tone ? { tone: b.tone } : {}),
    ...(b.key ? { key: b.key } : {}),
    texture: { id: 'harness-label', src: '/harness/label.png', width: 2048, height: 1024, kind: 'label' },
    shape: 'can',
    side: '#d8d4ce',
    productAspect: 2.2,
    ...(b.tagline ? { tagline: b.tagline } : {}),
    ...(b.endCard ? { endCard: b.endCard } : {}),
    ...(b.light ? { light: b.light } : {}),
    ...(b.grade ? { grade: b.grade } : {}),
    ...(b.finish ? { finish: b.finish } : {}),
    title,
    ...(price !== undefined ? { price } : {}),
    currency: 'USD',
    accent: b.endCard?.accent ?? '#c27a3a',
    ingredients: {},
  };
  try {
    const film = buildCinematicFilm(input);
    writeFileSync(join(out, 'film.json'), JSON.stringify(film));
    const verdict = lightValidate(JSON.parse(JSON.stringify(film)));
    return verdict.ok ? { ok: true, saw: 'built and accepted by the engine validator' } : { ok: false, saw: JSON.stringify(verdict.issues).slice(0, 300) };
  } catch (err) {
    return { ok: false, saw: err instanceof Error ? err.message : String(err) };
  }
}

const tally = (label: string, items: string[]): void => {
  const n = new Map<string, number>();
  for (const x of items) n.set(x, (n.get(x) ?? 0) + 1);
  console.log(`  ${label}: ${[...n.entries()].sort((a, z) => z[1] - a[1]).map(([k, c]) => `${k} x${c}`).join(', ') || 'none'}`);
};

const main = async () => {
  const runs = Math.max(1, Number(opt('runs') ?? 1));
  const seconds = Number(opt('seconds') ?? 8);
  const { title, price, aspect, planned } = await plan(runs);
  let failed = 0;
  for (const [n, p] of planned.entries()) {
    if (planned.length > 1) console.log(`\n==================== RUN ${n + 1} OF ${planned.length} ====================`);
    describe(p.board);
    const verdicts = judge(p.board, seconds, p.source, p.violations);
    const built = buildFilm(p.board, title, aspect, price);
    verdicts.push({ level: built.ok ? 'PASS' : 'FAIL', rule: 'the board builds into a film the engine accepts', saw: built.saw });
    console.log('\nJUDGEMENT');
    for (const x of verdicts) console.log(`  ${x.level.padEnd(4)}  ${x.rule}\n        saw: ${x.saw}`);
    const f = verdicts.filter((x) => x.level === 'FAIL').length;
    const w = verdicts.filter((x) => x.level === 'WARN').length;
    console.log(`\n  ${f ? 'FAIL' : 'PASS'}: ${verdicts.length - f - w} passed, ${w} to look at, ${f} failed`);
    failed += f;
  }
  if (planned.length > 1) {
    const beats = planned.flatMap((p) => p.board.sheet.beats);
    console.log('\nACROSS THE RUNS (does Muse decide, or repeat itself?)');
    tally('moves', beats.map((s) => s.move));
    tally('cuts', beats.slice(1).map((s) => s.cut ?? 'hard'));
    tally('sets', planned.map((p) => p.board.set?.look ?? 'none'));
    tally('end-card faces', planned.map((p) => p.board.endCard?.face ?? 'default'));
    tally('end-card letters', planned.map((p) => p.board.endCard?.letters ?? 'default'));
  }
  process.exit(failed ? 1 : 0);
};

if (!existsSync('package.json')) throw new Error('run from the repo root');
main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(2);
});
