import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Job } from '@shared/crew';
import type { LlmBackend, ToolCall } from '@shared/ports';
import type { Scene, Storyboard } from '@shared/storyboard';
import { addScene, newFilmComposition, registerAsset } from '../authoring/api';
import type { Comp, Obj } from '../authoring/types';
import { makeTestCrew } from '../crew/test-helpers';
import { createWorkerRegistry } from '../crew/workers/registry';
import { BIBLE_FONT_STACKS } from '../authoring/constants';
import { ensureBasics, runBlockJob } from './blocking';

const saved = { ...process.env };
beforeEach(() => {
  process.env.CARTOON_MODE = 'true';
});
afterEach(() => {
  process.env = { ...saved };
});

const base: Scene = { id: 's1', durationSec: 4, intent: 'hero', shotType: 'hero', camera: 'static', layersWanted: ['bg'], mode: 'motion', modeReason: 'r' };
const s2: Scene = { ...base, id: 's2', beats: 'Pip waves, then the can is held up', castIds: ['pip'], cues: [{ atSec: 1, actorId: 'pip', clip: 'Wave' }], lightCue: 'dawn', text: 'Hello' };
const storyboard: Storyboard = { title: 'T', aspect: '16:9', durationSec: 12, palette: ['#f4ead5'], scenes: [base, s2, { ...base, id: 's3' }] };
const ac = () => new AbortController().signal;

function scripted(turns: Array<Array<{ name: string; args: unknown }>>) {
  const queue = [...turns];
  const seen: string[] = [];
  let n = 0;
  const b: LlmBackend & { seen: string[] } = {
    id: 'spark',
    seen,
    async chatWithTools(messages) {
      seen.push(JSON.stringify(messages.at(-1)));
      const calls = queue.shift() ?? [];
      const t = n++;
      return { toolCalls: calls.map((c, i): ToolCall => ({ id: `c${t}_${i}`, name: c.name, args: c.args })), ms: 1 };
    },
  };
  return b;
}

async function setup() {
  const t = await makeTestCrew();
  let c: Comp = newFilmComposition({ aspect: '16:9', title: 'T', palette: ['#f4ead5'] });
  c = registerAsset(c, { id: 'pip', kind: 'model', src: '/cartoon/toy-character.glb' });
  c = registerAsset(c, { id: 'walk', kind: 'model', src: '/cartoon/clip-walk.glb' });
  c = registerAsset(c, { id: 'backdrop', kind: 'image', src: '/cartoon/backdrop.png', width: 1024, height: 512 });
  for (const id of ['s1', 's2', 's3']) c = addScene(c, { id, durationSec: 4, mode: 'motion' });
  await t.film.films.commit(t.film.filmId, c, 'director');
  await t.film.films.update(t.film.filmId, { storyboard, clips: [{ id: 'wave', name: 'Wave' }, { id: 'walk', name: 'Walk', assetId: 'walk' }] });
  const job = (): Job => t.board.add({ kind: 'block-shot', origin: 'showrunner', sceneId: 's2', brief: 'block it', reason: 'r' });
  const comp = async () => (await t.film.films.get(t.film.filmId)).composition as Comp;
  return { ...t, job, comp };
}
const scene = (c: Comp, id: string) => JSON.stringify((c.precomps as Record<string, Obj>)[id]);
const layers = (c: Comp, id: string) => (c.precomps as Record<string, Obj>)[id]!.layers as Obj[];

const shot = [
  { name: 'addStage', args: { sceneId: 's2', backdropAssetId: 'backdrop' } },
  { name: 'placeActor', args: { sceneId: 's2', actorId: 'pip', assetId: 'pip', mark: [-1.5, 0, 20] } },
  { name: 'setLightCue', args: { sceneId: 's2', cue: 'dawn' } },
];

describe('runBlockJob', () => {
  it('cues a clip that is its own file by its asset', async () => {
    const t = await setup();
    const b = scripted([[...shot, { name: 'cueClip', args: { sceneId: 's2', actorId: 'pip', clip: 'walk', atSec: 1, loop: true } }]]);
    await runBlockJob(t.job(), ac(), t.crew, { backendFor: () => b });
    const pip = layers(await t.comp(), 's2').find((l) => l.id === 's2:pip')!;
    expect(pip.clips.at(-1)).toMatchObject({ clipAssetId: 'walk', startFrame: 30, loop: true });
    expect(pip.clips.at(-1).name).toBeUndefined();
  });

  it('stages its own scene only, and gives it a floor and its title', async () => {
    const t = await setup();
    const before = await t.comp();
    const b = scripted([[...shot, { name: 'cueClip', args: { sceneId: 's2', actorId: 'pip', clip: 'Wave', atSec: 1 } }]]);
    const r = await runBlockJob(t.job(), ac(), t.crew, { backendFor: () => b });
    expect(r.summary).toBe('4 tool calls, 4 ok');
    const after = await t.comp();
    expect(scene(after, 's1')).toBe(scene(before, 's1'));
    expect(scene(after, 's3')).toBe(scene(before, 's3'));
    const ids = layers(after, 's2').map((l) => l.id);
    expect(ids).toEqual(expect.arrayContaining(['s2:world', 's2:pip', 's2:headline']));
    expect(layers(after, 's2').some((l) => l.kind === 'shape')).toBe(true);
    expect(b.seen[0]).toMatch(/Wave|tool/); // the model was asked
  });

  it('refuses a cue for a clip the film does not have, shows the list, and succeeds after the retry', async () => {
    const t = await setup();
    const b = scripted([
      [...shot, { name: 'cueClip', args: { sceneId: 's2', actorId: 'pip', clip: 'Backflip', atSec: 1 } }],
      [{ name: 'cueClip', args: { sceneId: 's2', actorId: 'pip', clip: 'Wave', atSec: 1 } }],
    ]);
    const r = await runBlockJob(t.job(), ac(), t.crew, { backendFor: () => b });
    expect(r.summary).toBe('5 tool calls, 4 ok');
    expect(b.seen[1]).toMatch(/no clip 'Backflip'/);
    expect(b.seen[1]).toMatch(/Wave, Walk/);
    const pip = layers(await t.comp(), 's2').find((l) => l.id === 's2:pip')!;
    expect(pip.clips.map((k: Obj) => k.name)).toContain('Wave');
  });

  it('takes a plain word for the nearest clip the film has', async () => {
    const t = await setup();
    const b = scripted([[...shot, { name: 'cueClip', args: { sceneId: 's2', actorId: 'pip', clip: 'shuffle over', atSec: 1 } }]]);
    const r = await runBlockJob(t.job(), ac(), t.crew, { backendFor: () => b });
    expect(r.summary).toBe('4 tool calls, 4 ok');
    const pip = layers(await t.comp(), 's2').find((l) => l.id === 's2:pip')!;
    expect(pip.clips.map((k: Obj) => k.clipAssetId)).toContain('walk'); // the walk clip is its own file
  });

  it("sets the headline in the style bible's font stack, so the continuity check agrees", async () => {
    const t = await setup();
    const bible = { palette: ['#f4ead5', '#1b1b1b'], type: { font: 'rounded', weight: 700 } } as never;
    await ensureBasics({ ...t.crew.toolCtx, scope: { sceneId: 's2' } }, 's2', 'Hello', ['#f4ead5', '#1b1b1b'], bible);
    const head = layers(await t.comp(), 's2').find((l) => l.id === 's2:headline')!;
    expect(head.style.font).toBe(BIBLE_FONT_STACKS.rounded);
    expect(head.style.weight).toBe(700);
  });

  it('refuses a call that reaches into another scene', async () => {
    const t = await setup();
    const b = scripted([[...shot, { name: 'addStage', args: { sceneId: 's1' } }]]);
    const before = scene(await t.comp(), 's1');
    const r = await runBlockJob(t.job(), ac(), t.crew, { backendFor: () => b });
    expect(r.summary).toBe('4 tool calls, 3 ok');
    expect(scene(await t.comp(), 's1')).toBe(before);
  });

  it('fails when the model makes no progress, and is mapped by the worker registry', async () => {
    const t = await setup();
    await expect(runBlockJob(t.job(), ac(), t.crew, { backendFor: () => scripted([]) })).rejects.toThrow(/no progress/);
    const reg = createWorkerRegistry();
    expect(typeof reg['block-shot']).toBe('function');
    // with CARTOON_MODE on the forge kinds are answered by the fixture forge; off, there is no forge and they say so
    process.env.CARTOON_MODE = 'false';
    await expect(createWorkerRegistry()['make-prop']!(t.job(), ac(), t.crew)).rejects.toThrow(/forge/);
  });
});
