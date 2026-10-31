// Owned by S16b. The offline toy-studio crew (DIRECTOR_FAKE=1 with CARTOON_MODE=true): a scripted showrunner that casts, dresses, asks for motion, then blocks three shots,
// and a blocker that stages them with the stage API. No model, no forge, no network.
import type { Job } from '@shared/crew';
import type { LlmBackend, ToolCall } from '@shared/ports';
import type { Comp } from '../authoring/types';
import type { CrewCtx } from '../crew/showrunner-tools';
import type { WorkerFn } from '../crew/workers';
import { addStage, cueClip, moveActor, placeActor, placeProp, setLightCue, type LightCue, type Mark } from './stage-api';

type Call = { name: string; args: unknown };
const FPS = 30;
const textOf = (content: unknown): string =>
  typeof content === 'string' ? content : Array.isArray(content) ? content.map((p: { type?: string; text?: string }) => (p.type === 'text' ? p.text ?? '' : '')).join('\n') : '';

const BIBLE = { palette: ['#f4ead5', '#1b1b1b', '#c2410c'], light: 'warm toy-room light', camera: 'locked', type: { font: 'Inter', weight: 800, case: 'title' }, productLine: 'a small can of cold brew', mood: 'cheerful' };
const SCENES = [
  { id: 's1', beats: 'Pip waves hello in a sunny toy room.', text: 'Pip & the Cold Brew', cues: [{ atSec: 1, actorId: 'pip', clip: 'Wave' }], lightCue: 'dawn' },
  { id: 's2', beats: 'Pip walks to the middle of the room.', cues: [{ atSec: 0.5, actorId: 'pip', clip: 'Walk' }], lightCue: 'studio' },
  { id: 's3', beats: 'Pip jumps for joy beside a crate.', text: 'Cold Brew Joy', cues: [{ atSec: 2, actorId: 'pip', clip: 'Jump' }], lightCue: 'spotlight' },
] as const;

export function createCartoonFakeShowrunner(): LlmBackend {
  let planned = false;
  let blocked = false;
  let finished = false;
  let n = 0;
  const reply = (calls: Call[]) => {
    const turn = n++;
    return { toolCalls: calls.map((c, i): ToolCall => ({ id: `cfake_${turn}_${i}`, name: c.name, args: c.args })), ms: 5, usage: { promptTokens: 8000, completionTokens: 1500 } };
  };
  return {
    id: 'wonder',
    async chatWithTools(messages) {
      await new Promise((r) => setTimeout(r, 20));
      const text = textOf(messages.at(-1)?.content);
      if (!text.includes('BOARD')) return reply([]);
      const counts = /(\d+) running · (\d+) queued/.exec(text);
      const idle = Number(counts?.[1] ?? 0) === 0 && Number(counts?.[2] ?? 0) === 0;
      if (!planned && text.includes('New film')) {
        planned = true;
        return reply([
          { name: 'setStyleBible', args: BIBLE },
          { name: 'reviseStoryboard', args: { ops: SCENES.map((s) => ({ op: 'add', scene: { id: s.id, durationSec: 4, intent: s.beats, shotType: 'hero', camera: 'static', layersWanted: ['bg'], mode: 'motion', modeReason: 'a toy-studio shot', beats: s.beats, castIds: ['pip'], cues: s.cues, lightCue: s.lightCue, ...('text' in s ? { text: s.text } : {}) } })), reason: 'Three shots' } },
          { name: 'say', args: { text: 'Three shots: Pip waves, walks and jumps. Casting now.' } },
          { name: 'castCharacter', args: { name: 'Pip', description: 'a small orange toy figure' } },
          { name: 'dressSet', args: { place: 'a sunny toy room', props: ['crate'] } },
          ...['Wave', 'Walk', 'Jump'].map((name) => ({ name: 'requestMotion', args: { name, from: 'library' } })),
        ]);
      }
      if (planned && !blocked && idle) {
        blocked = true;
        return reply(SCENES.map((s) => ({ name: 'blockShot', args: { sceneId: s.id } })));
      }
      if (blocked && !finished && idle && /s1 .*done|done/.test(text)) {
        finished = true;
        return reply([{ name: 'finish', args: { summary: 'Three toy-studio shots blocked.' } }]);
      }
      return reply([]);
    },
  };
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => (clearTimeout(t), reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))), { once: true });
  });

/** A blocker with no model: stands each cast member on the grid, plays the cues, lights the shot. */
export function createFakeBlocker(o: { delayMs?: number } = {}): WorkerFn {
  return async (job: Job, signal, crew: CrewCtx) => {
    const sceneId = job.sceneId;
    if (!sceneId) throw new Error('block-shot needs a scene');
    await sleep(o.delayMs ?? Number(process.env.DIRECTOR_FAKE_DELAY_MS ?? 400), signal);
    const film = await crew.films.get(job.filmId);
    const scene = film.storyboard?.scenes.find((s) => s.id === sceneId);
    if (!scene) throw new Error(`unknown scene ${sceneId}`);
    const cast = film.cast ?? [];
    // loaded here: blocking pulls in the whole tool registry, which a route registration does not need
    const { ensureBasics } = await import('./blocking');
    await ensureBasics({ ...crew.toolCtx, signal, source: 'director' }, sceneId, scene.text, film.storyboard!.palette, film.styleBible);
    const set = cast.find((m) => m.kind === 'set' && m.assetId);
    const crate = cast.find((m) => m.kind === 'prop' && m.assetId);
    const actors = (scene.castIds ?? []).slice(0, 3);
    const r = await crew.films.mutate(
      job.filmId,
      (f) => {
        let c = addStage(f.composition as Comp, sceneId, { ...(set?.assetId ? { backdropAssetId: set.assetId } : {}) });
        actors.forEach((id, i) => {
          const m = cast.find((x) => x.id === id)!;
          c = placeActor(c, sceneId, id, m.assetId!, [actors.length === 1 ? 0 : [-1.5, 0, 1.5][i]!, 0, 0] as Mark);
        });
        for (const cue of scene.cues ?? []) {
          const clip = cast.find((m) => m.kind === 'motion' && m.name.toLowerCase() === cue.clip.toLowerCase());
          const at = Math.round(cue.atSec * FPS);
          c = cueClip(c, sceneId, cue.actorId, clip?.assetId ? { assetId: clip.assetId } : { name: cue.clip }, at);
          if (cue.mark) c = moveActor(c, sceneId, cue.actorId, cue.mark as Mark, at, FPS);
        }
        if (crate && sceneId === 's3') c = placeProp(c, sceneId, 'crate', { assetId: crate.assetId!, size: 0.3, position: [1.5, 0, 0] });
        c = setLightCue(c, sceneId, (scene.lightCue ?? 'studio') as LightCue);
        return { next: c, data: null };
      },
      'director',
      `block-shot ${sceneId} (${job.id})`,
    );
    if (!r.ok) throw new Error(`the shot was refused: ${JSON.stringify(r.issues).slice(0, 200)}`);
    return { summary: `blocked ${sceneId}`, version: r.version, costUsd: 0, model: 'fake' };
  };
}
