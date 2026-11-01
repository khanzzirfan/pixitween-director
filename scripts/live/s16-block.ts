// S16b live check: three real Spark blocking jobs, one per scene, on the engine's fixture cast (toy character, walk and jump clips, a crate, a painted backdrop).
// Paid, so it prints an estimate and exits unless --yes is passed. Writes the film to web/public/cartoon/live-film.json: open /stage-check.html?film=live to watch it.
import { mkdirSync, writeFileSync } from 'node:fs';
import type { Job } from '@shared/crew';
import type { Storyboard } from '@shared/storyboard';
import { addScene, newFilmComposition, registerAsset } from '../../server/authoring/api';
import type { Comp } from '../../server/authoring/types';
import { runBlockJob } from '../../server/cartoon/blocking';
import { createBoard } from '../../server/crew/board';
import type { CrewCtx } from '../../server/crew/showrunner-tools';
import { buildDeps } from '../../server/main';
import type { LiveScript } from './run';

export const describe: LiveScript['describe'] = () =>
  'S16b live: three real Spark block-shot jobs (one per scene) on the fixture toy cast. Needs META_API_KEY and CARTOON_MODE=true. Prints each job, the cost, and writes web/public/cartoon/live-film.json.';
/** About $0.05 each: one short tool loop of up to 8 turns on Spark. */
export const estimateUsd: LiveScript['estimateUsd'] = () => 0.15;

const scene = (id: string, beats: string, o: Partial<Storyboard['scenes'][number]> = {}): Storyboard['scenes'][number] => ({
  id, durationSec: 4, intent: beats, shotType: 'hero', camera: 'static', layersWanted: ['bg'], mode: 'motion', modeReason: 'toy-studio cartoon shot', beats, castIds: ['pip'], ...o,
});
export const STORYBOARD: Storyboard = {
  title: 'Pip & the Cold Brew',
  aspect: '16:9',
  durationSec: 12,
  palette: ['#f4ead5', '#1b1b1b', '#c2410c'],
  scenes: [
    scene('s1', 'Pip stands in a sunny toy room and waves hello.', { text: 'Pip & the Cold Brew', cues: [{ atSec: 1, actorId: 'pip', clip: 'Wave' }], lightCue: 'dawn' }),
    scene('s2', 'A friend (the same toy character, smaller) walks in from the right and stops beside Pip.', { cues: [{ atSec: 0.5, actorId: 'friend', clip: 'Walk' }], lightCue: 'studio' }),
    scene('s3', 'Pip holds up a can of cold brew in the right hand and jumps for joy.', { text: 'Coffee Co. Cold Brew', cues: [{ atSec: 2, actorId: 'pip', clip: 'Jump' }], lightCue: 'spotlight', shotType: 'closer' }),
  ],
};

export const run: LiveScript['run'] = async ({ env, log }) => {
  if (!env.CARTOON_MODE) throw new Error('CARTOON_MODE is off: set CARTOON_MODE=true before running s16-block');
  if (!env.metaApiKey) throw new Error('META_API_KEY is required for s16-block');
  const deps = await buildDeps(env);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const photo = await deps.assets.put(png, 'image/png', { role: 'product-photo' });
  const film = await deps.films.create({ aspect: '16:9', title: STORYBOARD.title, brief: { text: 'Pip the toy and a can of cold brew', productAssetId: photo.id }, assets: [photo], crew: true });

  let c: Comp = newFilmComposition({ aspect: '16:9', title: STORYBOARD.title, palette: STORYBOARD.palette });
  for (const [id, file] of [['pip', 'toy-character'], ['walk', 'clip-walk'], ['jump', 'clip-jump'], ['crate', 'prop-crate']] as const) c = registerAsset(c, { id, kind: 'model', src: `/cartoon/${file}.glb` });
  c = registerAsset(c, { id: 'backdrop', kind: 'image', src: '/cartoon/backdrop.png', width: 1024, height: 512 });
  for (const s of STORYBOARD.scenes) c = addScene(c, { id: s.id, durationSec: s.durationSec, mode: 'motion' });
  const first = await deps.films.commit(film.id, c, 'director');
  if (!first.ok) throw new Error(`base film refused: ${JSON.stringify(first.issues).slice(0, 300)}`);
  await deps.films.update(film.id, {
    storyboard: STORYBOARD,
    clips: [{ id: 'wave', name: 'Wave' }, { id: 'idle', name: 'Idle' }, { id: 'walk', name: 'Walk', assetId: 'walk' }, { id: 'jump', name: 'Jump', assetId: 'jump' }],
  });

  const board = createBoard({ filmId: film.id, emit: () => undefined, persist: () => undefined as never });
  const toolCtx = deps.makeToolCtx(film.id);
  const crew = { filmId: film.id, films: deps.films, board, emit: toolCtx.emit, source: 'showrunner', toolCtx, makeToolCtx: deps.makeToolCtx } as unknown as CrewCtx;
  const jobs: Job[] = STORYBOARD.scenes.map((s) => board.add({ kind: 'block-shot', origin: 'showrunner', sceneId: s.id, brief: s.beats ?? '', reason: 'live check' }));
  const t0 = Date.now();
  // one writer per scene, all at once, like the crew's parallel builders
  const results = await Promise.allSettled(jobs.map((j) => runBlockJob(j, new AbortController().signal, crew)));
  results.forEach((r, i) => log(`${jobs[i]!.sceneId}: ${r.status === 'fulfilled' ? `ok - ${r.value.summary}, $${(r.value.costUsd ?? 0).toFixed(3)}` : `FAILED - ${String(r.reason).slice(0, 300)}`}`));
  const final = await deps.films.get(film.id);
  mkdirSync('debug/s16', { recursive: true });
  writeFileSync('web/public/cartoon/live-film.json', JSON.stringify(final.composition, null, 2));
  writeFileSync(`debug/s16/block-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, JSON.stringify({ filmId: film.id, results: results.map((r) => (r.status === 'fulfilled' ? r.value : String(r.reason))), composition: final.composition }, null, 2));
  log(`total $${final.costUsd.toFixed(3)} in ${((Date.now() - t0) / 1000).toFixed(0)} s. Open /stage-check.html?film=live`);
  if (results.some((r) => r.status === 'rejected')) process.exitCode = 1;
};
