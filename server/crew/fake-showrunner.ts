// Owned by S12b. A whole crew with no network (DIRECTOR_FAKE=1): a scripted showrunner that reads the same BOARD text the real one gets,
// and workers that build scenes with the authoring core after a delay, so four lanes are busy together in the offline run and the e2e.
import type { Job, JobKind } from '@shared/crew';
import type { LlmBackend, ToolCall } from '@shared/ports';
import { addLayer, removeLayer } from '../authoring/api';
import { readDirector } from '../authoring/meta';
import type { Comp } from '../authoring/types';
import { loadEnv } from '../env';
import type { CrewCtx } from './showrunner-tools';
import type { WorkerFn } from './workers';

type Call = { name: string; args: unknown };

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => (clearTimeout(t), reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))), { once: true });
  });

const textOf = (content: unknown): string =>
  typeof content === 'string' ? content : Array.isArray(content) ? content.map((p: { type?: string; text?: string }) => (p.type === 'text' ? p.text ?? '' : '')).join('\n') : '';

const PLAN = [
  { intent: 'Reveal the can in low morning light', shotType: 'hero', camera: 'dolly-in', text: 'Slow mornings' },
  { intent: 'The pour into a glass over ice', shotType: 'lifestyle', camera: 'parallax', text: 'Poured with care' },
  { intent: 'A close look at the label', shotType: 'detail', camera: 'pan', text: 'Every detail' },
  { intent: 'Close on the can with the tagline', shotType: 'closer', camera: 'static', text: 'Made for mornings' },
] as const;

const BIBLE = {
  palette: ['#1f2937', '#f59e0b', '#fde68a'],
  light: 'low warm morning sun from the left',
  camera: 'slow dolly-ins, no fast cuts',
  type: { font: 'Inter', weight: 800, case: 'upper' },
  productLine: 'a matte slate can with a small orange mountain',
  mood: 'calm, early',
};

const scene = (p: { intent: string; shotType: string; camera: string; text: string }, durationSec = 4, mode: 'motion' | '3d' = 'motion') => ({
  durationSec, intent: p.intent, shotType: p.shotType, camera: p.camera, layersWanted: ['bg', 'product', 'headline'], text: p.text, mode,
  modeReason: mode === '3d' ? 'The product itself is the shot, so the real product turns in the light.' : 'A still is enough for this shot.',
});

/** Reads the BOARD table: scene ids with their status, and the running and queued counts. */
function readBoard(text: string) {
  const rows = [...text.matchAll(/^(s\d+) \| \d+(?:\.\d+)?s \| \w+\s* \| (\S+)/gm)].map((m) => ({ id: m[1]!, status: m[2]! }));
  const counts = /(\d+) running · (\d+) queued/.exec(text);
  return { rows, running: Number(counts?.[1] ?? 0), queued: Number(counts?.[2] ?? 0) };
}

export function createFakeShowrunner(o: { delayMs?: number } = {}): LlmBackend {
  const delay = () => o.delayMs ?? Number(process.env.DIRECTOR_FAKE_DELAY_MS ?? 400);
  let planned = false;
  let warmer = false;
  let finishedFor = '';
  const restyled = new Set<string>();
  const handled = new Set<string>();
  const fixed = new Set<string>();
  let n = 0;
  let takeRounds = 0;

  return {
    id: 'wonder',
    async chatWithTools(messages, _tools, opts) {
      await sleep(delay() / 2, opts?.signal);
      const last = messages.at(-1);
      const text = textOf(last?.content);
      const calls: Call[] = [];
      const board = readBoard(text);
      const inbox = text.split('NEW IN YOUR INBOX')[1] ?? '';

      if (!text.includes('BOARD')) return reply(n++, [], 'Understood.'); // a repair prompt: nothing to repair here
      if (!planned && inbox.includes('New film')) {
        planned = true;
        calls.push({ name: 'setStyleBible', args: BIBLE });
        // with PRODUCT_3D the hero scene shows the product turning, so the 3D path is rehearsed offline
        const three = loadEnv().PRODUCT_3D;
        calls.push({ name: 'reviseStoryboard', args: { ops: PLAN.map((p, i) => ({ op: 'add', scene: scene(p, 4, three && i === 0 ? '3d' : 'motion') })), reason: 'Four scenes', ...(three ? { productShape: 'can' } : {}) } });
        calls.push({ name: 'say', args: { text: 'Four scenes: the reveal, the pour, the label and the close.' } });
        PLAN.forEach((p, i) => calls.push({ name: 'dispatch', args: { kind: 'build-scene', sceneId: `s${i + 1}`, brief: p.intent, reason: 'first build' } }));
        return reply(n++, calls);
      }

      let nextId = Math.max(0, ...board.rows.map((r) => Number(r.id.slice(1)))) + 1;
      const touched = new Set<string>();
      for (const line of inbox.split('\n')) {
        const user = /^\[user [^\]]*\] (.*) \(selection: .*\)$/.exec(line);
        if (!user) continue;
        const msg = user[1]!;
        if (/warm/i.test(msg)) warmer = true;
        const takeScene = /\btakes?\b/i.test(msg) ? /scene (\d)/i.exec(msg)?.[1] : undefined;
        if (takeScene && board.rows.some((r) => r.id === `s${takeScene}`)) {
          calls.push({ name: 'dispatch', args: { kind: 'take', sceneId: `s${takeScene}`, brief: 'Three variations of the scene', reason: 'you asked for takes', takes: 3 } });
          calls.push({ name: 'say', args: { text: `Three takes of scene ${takeScene} are coming.` } });
          takeRounds++;
          continue;
        }
        if (/scene/i.test(msg) && /(add|new|another|sunset)/i.test(msg)) {
          const after = /after (?:scene )?(\d)/i.exec(msg)?.[1];
          const id = `s${nextId++}`;
          calls.push({ name: 'reviseStoryboard', args: { ops: [{ op: 'add', scene: scene({ intent: 'Sunset glow wraps the can', shotType: 'lifestyle', camera: 'dolly-in', text: 'Golden hour' }), after: after ? `s${after}` : 's2' }], reason: 'The user asked for a sunset scene' } });
          calls.push({ name: 'say', args: { text: `Adding a sunset scene${warmer ? ' and warming the light everywhere' : ''}.` } });
          calls.push({ name: 'dispatch', args: { kind: 'build-scene', sceneId: id, brief: 'Sunset glow wraps the can', reason: 'you asked for a sunset scene' } });
          touched.add(id);
        } else calls.push({ name: 'say', args: { text: warmer ? 'Warming the light everywhere.' : 'On it.' } });
      }
      if (warmer) {
        for (const r of board.rows) {
          if (r.status === 'done' && !restyled.has(r.id) && !touched.has(r.id)) {
            restyled.add(r.id);
            calls.push({ name: 'dispatch', args: { kind: 'restyle-scene', sceneId: r.id, brief: 'Warmer light: shift the background to golden hour and keep the product and headline.', reason: 'you asked for warmer light' } });
          }
        }
      }
      for (const m of inbox.matchAll(/^\[critic (j\d+)\] (.*)$/gm)) {
        if (handled.has(m[1]!)) continue;
        handled.add(m[1]!);
        const sceneId = /\b(s\d+)\b/.exec(m[2]!)?.[1];
        if (sceneId && !fixed.has(sceneId) && fixed.add(sceneId)) calls.push({ name: 'dispatch', args: { kind: 'fix', sceneId, brief: 'Move the headline clear of the product.', reason: 'the critic saw the headline over the can' } });
      }

      const dispatching = calls.some((c) => c.name === 'dispatch');
      const allDone = board.rows.length > 0 && board.rows.every((r) => r.status === 'done');
      const signature = `${board.rows.length}:${[...restyled].join(',')}:${handled.size}:${takeRounds}`;
      if (!dispatching && allDone && board.running === 0 && board.queued === 0 && finishedFor !== signature) {
        finishedFor = signature;
        calls.push({ name: 'finish', args: { summary: `${board.rows.length} scenes built and checked.` } });
      }
      return reply(n++, calls);
    },
  };
}

function reply(turn: number, calls: Call[], content?: string) {
  return {
    toolCalls: calls.map((c, i): ToolCall => ({ id: `fake_${turn}_${i}`, name: c.name, args: c.args })),
    ...(content ? { content } : {}),
    ms: 5,
    usage: { promptTokens: 8000, completionTokens: 1500 },
  };
}

const PRICE: Partial<Record<JobKind, number>> = { 'build-scene': 0.03, 'rebuild-scene': 0.03, 'restyle-scene': 0.02, edit: 0.02, fix: 0.02, critique: 0.01 };

/** One worker for every kind the fake crew uses. */
export function createFakeWorkers(o: { delayMs?: number } = {}): Partial<Record<JobKind, WorkerFn>> {
  const delay = () => (o.delayMs ?? Number(process.env.DIRECTOR_FAKE_DELAY_MS ?? 400)) * 2;
  let findingSent = false;

  // the lane events the real workers emit, so the offline run lights up the board and the map too
  const lane = async <T>(job: Job, crew: CrewCtx, which: 'builder' | 'critic', run: () => Promise<T>): Promise<T> => {
    const worker = which === 'critic' ? 'critic' : (job.worker ?? 'builder');
    crew.emit({ type: 'crew.agent', lane: which, worker, state: 'working', jobId: job.id, model: 'muse-spark-fake' });
    try {
      return await run();
    } finally {
      crew.emit({ type: 'crew.agent', lane: which, worker, state: 'idle', jobId: job.id, model: 'muse-spark-fake' });
    }
  };

  const change: (kind: JobKind) => WorkerFn = (kind) => (job, signal, crew) => lane(job, crew, 'builder', () => build(kind, job, signal, crew));
  const build = async (kind: JobKind, job: Job, signal: AbortSignal, crew: CrewCtx) => {
    await sleep(delay(), signal);
    const film = await crew.films.get(job.filmId);
    const sc = film.storyboard?.scenes.find((s) => s.id === job.sceneId);
    if (!sc || !job.sceneId) throw new Error(`unknown scene ${job.sceneId}`);
    const palette = film.styleBible?.palette ?? film.storyboard!.palette;
    const sceneId = job.sceneId;
    const r = await crew.films.mutate(
      job.filmId,
      (f) => {
        let c = f.composition as Comp;
        const meta = readDirector(c);
        const own = Object.entries(meta.layers).filter(([, m]) => m.sceneId === sceneId);
        if (kind === 'build-scene' || kind === 'rebuild-scene') {
          for (const [id, m] of own) if (m.role !== 'camera') c = removeLayer(c, id);
          c = addLayer(c, { sceneId, role: 'bg', kind: 'shape', fill: palette[0]! }); // the darkest colour keeps the white headline readable
          if (c.assets[film.brief.productAssetId]) c = addLayer(c, { sceneId, role: 'product', kind: 'image', assetId: film.brief.productAssetId, box: { x: Math.round(c.width * 0.36), y: Math.round(c.height * 0.06), w: Math.round(c.width * 0.28), h: Math.round(c.height * 0.5) } }); // above the headline, so the two never overlap
          if (sc.text) c = addLayer(c, { sceneId, role: 'headline', kind: 'text', text: sc.text, box: { x: Math.round(c.width * 0.12), y: Math.round(c.height * 0.78), w: Math.round(c.width * 0.76), h: Math.round(c.height * 0.14) } });
        } else if (kind === 'restyle-scene') {
          if (meta.layers[`${sceneId}:bg`]) c = removeLayer(c, `${sceneId}:bg`);
          c = addLayer(c, { sceneId, role: 'bg', kind: 'shape', fill: '#b45309' });
        } else if (meta.layers[`${sceneId}:headline`] && sc.text) {
          c = removeLayer(c, `${sceneId}:headline`);
          c = addLayer(c, { sceneId, role: 'headline', kind: 'text', text: sc.text, box: { x: Math.round(c.width * 0.12), y: Math.round(c.height * 0.78), w: Math.round(c.width * 0.76), h: Math.round(c.height * 0.14) } });
        }
        return { next: c, data: null };
      },
      'director',
      `${job.kind} ${sceneId} (${job.id})`,
    );
    if (!r.ok) throw new Error('the composition was refused');
    crew.toolCtx.ledger.add(job.filmId, 'muse-spark-1.3-contributor', `fake ${job.kind}`, PRICE[kind] ?? 0.02);
    let version = r.version;
    // a 3d scene gets its turning product once its layers are in, through the same tool a real builder calls
    if (sc.mode === '3d' && (kind === 'build-scene' || kind === 'rebuild-scene') && loadEnv().PRODUCT_3D) {
      const { getTool } = await import('../tools/registry');
      const placed = await getTool('placeProduct3D')?.run({ ...crew.toolCtx, filmId: job.filmId, source: 'director' }, { sceneId });
      if (!placed?.ok) throw new Error(`placeProduct3D: ${placed ? placed.error : 'the tool is not available'}`);
      version = placed.version ?? version;
    }
    return { summary: `${kind} on ${sceneId}`, costUsd: PRICE[kind] ?? 0.02, version, model: 'fake' };
  };

  return {
    'build-scene': change('build-scene'),
    'rebuild-scene': change('rebuild-scene'),
    'restyle-scene': change('restyle-scene'),
    edit: change('edit'),
    fix: change('fix'),
    critique: (job, signal, crew) => lane(job, crew, 'critic', async () => {
      await sleep(delay() / 2, signal);
      // one finding, once, so the showrunner has something to answer with a fix
      if (!findingSent && job.sceneId) {
        findingSent = true;
        crew.inbox.push({ id: `fake-finding-${job.id}`, at: new Date().toISOString(), from: 'critic', jobId: job.id, text: `${job.sceneId} at 2.0s text-over-product: the headline crosses the product (measured overlap 31%)` });
      }
      crew.toolCtx.ledger.add(job.filmId, 'muse-spark-1.3-contributor', 'fake critique', PRICE.critique ?? 0.01);
      return { summary: 'one finding', costUsd: PRICE.critique, model: 'fake' };
    }),
    // a take is a copy of the film under a new id, scored by a fixed table: it shows the picker without a model
    take: (job, signal, crew) => lane(job, crew, 'builder', async () => {
      await sleep(delay(), signal);
      const sceneId = job.sceneId;
      if (!sceneId) throw new Error('a take needs a scene');
      const label = job.takeLabel ?? 'A';
      const parent = await crew.films.get(job.filmId);
      if (!parent.composition) throw new Error('the film has no composition to take from');
      const child = await crew.films.create({ aspect: parent.aspect, brief: parent.brief, assets: parent.assets, title: `${parent.title ?? 'Film'} (take ${label})`, parentId: parent.id, crew: false, ...(parent.storyboard ? { storyboard: parent.storyboard } : {}) });
      const committed = await crew.films.commit(child.id, parent.composition as Comp, 'director', `take ${label} base`);
      if (!committed.ok) throw new Error('the take could not start from the current film');
      await crew.films.update(child.id, { status: 'ready' });
      crew.emit({ type: 'take.ready', jobId: job.id, takeOf: job.takeOf ?? sceneId, sceneId, label, takeFilmId: child.id, thumbAssetId: parent.brief.productAssetId, score: { A: 6, B: 8, C: 7 }[label], note: 'fake take: a copy of the scene, not rebuilt' });
      crew.toolCtx.ledger.add(job.filmId, 'muse-spark-1.3-contributor', 'fake take', PRICE.edit ?? 0.02);
      return { summary: `take ${label} of ${sceneId}`, costUsd: PRICE.edit ?? 0.02, model: 'fake' };
    }),
    async continuity(_job, signal) {
      await sleep(10, signal);
      return { summary: 'no continuity errors' };
    },
  };
}

export function createFakeCrew(o: { delayMs?: number } = {}) {
  return { backend: createFakeShowrunner(o), workers: createFakeWorkers(o) };
}
