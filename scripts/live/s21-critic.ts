// S21 live: the critic. For each film of the cinematic catalogue (s20-cinematic), takes one frame per shot in headless Chromium, sends the frames
// and the board to Muse (Spark vision) and gets back scores on six criteria, issues seen in the frames and fixes as edits to the board.
// Fixes that keep the board passing the checker are applied to a NEW saved board (boards.critic.json); boards.json is not touched, so a person
// reads the verdict and chooses. About $0.005 a film. Needs the web dev server on :5173 (npm run dev:web). Writes the frames, verdicts and
// the edited boards to debug/s21-critic-<stamp>/.
// Usage: npm run live -- s21-critic [--base=http://localhost:5173] [--yes]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { applyFixes, critiqueFilm, frameTimes, CRITIC_CALL_USD } from '../../server/authoring/critic';
import type { CinematicBoard } from '../../server/authoring/beatsheet';
import { buildDeps } from '../../server/main';
import { filmFrames } from '../lib/film-frames';
import type { LiveScript } from './run';

const OUT = 'web/public/cartoon/catalog-cine';
const BOARDS = `${OUT}/boards.json`;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const boards = (): Record<string, CinematicBoard> => (existsSync(BOARDS) ? (JSON.parse(readFileSync(BOARDS, 'utf8')) as Record<string, CinematicBoard>) : {});
const films = () => Object.keys(boards()).filter((id) => existsSync(`${OUT}/${slug(id)}.json`));

export const describe: LiveScript['describe'] = () => `S21 live: grades each built cinematic film (${OUT}/*.json) from one frame per shot with Muse Spark vision: six scores, issues, and fixes as board edits. Needs META_API_KEY and the web dev server on :5173. Writes debug/s21-critic-<stamp>/; boards.json is not changed.`;
export const estimateUsd: LiveScript['estimateUsd'] = () => Math.round(films().length * CRITIC_CALL_USD * 10000) / 10000;

export const run: LiveScript['run'] = async ({ env, log, args }) => {
  if (!env.metaApiKey) throw new Error('META_API_KEY is required for s21-critic');
  const base = args?.find((a) => a.startsWith('--base='))?.slice(7);
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
  const dir = `debug/s21-critic-${stamp}`;
  mkdirSync(dir, { recursive: true });
  const deps = await buildDeps(env);
  const film = await deps.films.create({ aspect: '9:16', title: 'Critic', brief: { text: 'Critic', productAssetId: '' }, assets: [] });
  const ctx = deps.makeToolCtx(film.id);
  const all = boards();
  const edited: Record<string, CinematicBoard> = {};
  const report: Record<string, unknown> = {};
  let cost = 0;
  for (const id of films()) {
    const board = all[id]!;
    const times = frameTimes(board);
    const frames = await filmFrames({ ...(base ? { base } : {}), file: `/cartoon/catalog-cine/${slug(id)}.json`, times });
    frames.forEach((f, i) => writeFileSync(`${dir}/${slug(id)}-shot${i + 1}.png`, f));
    const c = await critiqueFilm(ctx, { board, frames, times });
    cost += CRITIC_CALL_USD;
    const fixed = applyFixes(board, c.fixes);
    edited[id] = fixed.board;
    report[id] = { ...c, applied: fixed.applied, refused: fixed.refused };
    log(`${id}: mean ${c.mean} ${c.pass ? 'PASS' : 'needs work'} ${JSON.stringify(c.scores)}`);
    for (const i of c.issues) log(`  shot ${i.shot} ${i.criterion}: ${i.evidence}`);
    for (const f of fixed.applied) log(`  fix applied: shot ${f.shot} ${f.field} -> ${f.value}${f.why ? ` (${f.why})` : ''}`);
    for (const r of fixed.refused) log(`  fix refused: shot ${r.fix.shot} ${r.fix.field} -> ${r.fix.value}: ${r.because.join('; ')}`);
    for (const d of c.dropped) log(`  fix dropped: ${d}`);
  }
  writeFileSync(`${dir}/verdicts.json`, JSON.stringify(report, null, 2));
  writeFileSync(`${dir}/boards.critic.json`, JSON.stringify(edited, null, 2));
  log(`done, about $${cost.toFixed(4)}; read ${dir}/verdicts.json, frames beside it; the edited boards are ${dir}/boards.critic.json (copy over ${BOARDS} to adopt, then rerun s20-cinematic)`);
};
