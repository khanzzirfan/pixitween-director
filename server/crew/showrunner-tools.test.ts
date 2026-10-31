import { describe, expect, it } from 'vitest';
import type { StoryboardOp } from '@shared/crew';
import type { Scene } from '@shared/storyboard';
import type { ToolDef, ToolResult } from '@shared/tools';
import { addLayer, setTransform } from '../authoring/api';
import { readDirector, sceneIds } from '../authoring/meta';
import type { Comp } from '../authoring/types';
import { createBoardTools } from './showrunner-tools';
import { makeTestCrew } from './test-helpers';

const settle = () => new Promise<void>((r) => setTimeout(r, 15)); // the bus appends events asynchronously
const scene: Omit<Scene, 'id'> = { durationSec: 4, intent: 'a scene', shotType: 'hero', camera: 'static', layersWanted: ['bg', 'product'], mode: 'motion', modeReason: 'a still is enough' };
const add = (n = 1): StoryboardOp[] => Array.from({ length: n }, () => ({ op: 'add' as const, scene }));
const bible = { palette: ['#1f2937', '#f59e0b'], light: 'warm', camera: 'slow', type: { font: 'sans', weight: 700, case: 'upper' as const }, productLine: 'a can', mood: 'calm' };

async function setup(o: Parameters<typeof makeTestCrew>[0] = {}) {
  const t = await makeTestCrew(o);
  const tools = createBoardTools(t.crew);
  const run = (name: string, args: unknown): Promise<ToolResult> => {
    const def = tools.find((d: ToolDef) => d.name === name)!;
    const parsed = def.params.safeParse(args);
    return parsed.success ? def.run(t.film.ctx, parsed.data) : Promise.resolve({ ok: false, error: parsed.error.issues[0]!.message });
  };
  return { ...t, run, tools };
}

describe('setStyleBible and reviseStoryboard', () => {
  it('stores the bible and announces it', async () => {
    const t = await setup();
    expect((await t.run('setStyleBible', bible)).ok).toBe(true);
    expect((await t.film.films.get(t.film.filmId)).styleBible).toEqual(bible);
    await settle();
    expect(t.events.map((e) => e.type)).toContain('style.bible');
  });

  it("keeps the product's shape in the storyboard and in the composition, and a 3d scene", async () => {
    const t = await setup();
    const r = await t.run('reviseStoryboard', { ops: [{ op: 'add', scene: { ...scene, mode: '3d', modeReason: 'the can itself turns' } }, ...add(1)], productShape: 'can' });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const film = await t.film.films.get(t.film.filmId);
    expect(film.storyboard?.productShape).toBe('can');
    expect(film.storyboard?.scenes[0]!.mode).toBe('3d');
    expect(readDirector(film.composition as Comp).productShape).toBe('can');
    // a 3d scene is a motion scene to the composition
    expect(readDirector(film.composition as Comp).scenes['s1']!.mode).toBe('motion');
    await t.run('reviseStoryboard', { ops: [{ op: 'update', sceneId: 's2', patch: { intent: 'x' } }] });
    expect((await t.film.films.get(t.film.filmId)).storyboard?.productShape).toBe('can');
  });

  it('rejects a palette entry that is a colour name', async () => {
    const t = await setup();
    expect((await t.run('setStyleBible', { ...bible, palette: ['red', '#f59e0b'] })).ok).toBe(false);
    expect((await t.film.films.get(t.film.filmId)).styleBible).toBeUndefined();
  });

  it('four adds on an empty film give rev 1, four builders needed and four scene precomps', async () => {
    const t = await setup();
    const r = await t.run('reviseStoryboard', { ops: add(4) });
    expect(r).toMatchObject({ ok: true, data: { rev: 1, needsBuilder: ['s1', 's2', 's3', 's4'], added: ['s1', 's2', 's3', 's4'] } });
    const film = await t.film.films.get(t.film.filmId);
    expect(sceneIds(film.composition as Comp)).toEqual(['s1', 's2', 's3', 's4']);
    expect(film.storyboardRev).toBe(1);
    expect(film.storyboard?.scenes).toHaveLength(4);
    await settle();
    expect(t.events.find((e) => e.type === 'storyboard.revised')).toMatchObject({ rev: 1, source: 'showrunner' });
    expect([...t.crew.turn.needsBuilder]).toEqual(['s1', 's2', 's3', 's4']);
  });

  it('seven scenes is refused naming the limit, and nothing changes', async () => {
    const t = await setup();
    await t.run('reviseStoryboard', { ops: add(4) });
    const r = await t.run('reviseStoryboard', { ops: add(3) });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/6/);
    const film = await t.film.films.get(t.film.filmId);
    expect(film.storyboardRev).toBe(1);
    expect(sceneIds(film.composition as Comp)).toHaveLength(4);
  });

  it('one scene alone cannot start a film (a storyboard has 2 to 6)', async () => {
    const t = await setup();
    expect((await t.run('reviseStoryboard', { ops: add(1) })).ok).toBe(false);
  });

  it('a later revision bumps the rev and applies a camera change at once with no builder', async () => {
    const t = await setup();
    await t.run('reviseStoryboard', { ops: add(3) });
    const r = await t.run('reviseStoryboard', { ops: [{ op: 'update', sceneId: 's2', patch: { camera: 'pan' } }] });
    expect(r).toMatchObject({ ok: true, data: { rev: 2, needsBuilder: [] } });
  });

  it('a removed scene id is not reused by a later add', async () => {
    const t = await setup();
    await t.run('reviseStoryboard', { ops: add(3) });
    await t.run('reviseStoryboard', { ops: [{ op: 'remove', sceneId: 's3' }] });
    const r = await t.run('reviseStoryboard', { ops: add(1) });
    expect(r).toMatchObject({ ok: true, data: { added: ['s4'] } });
  });

  it('removing a scene cancels its queued and running jobs first', async () => {
    const t = await setup({ runWorker: (_job, signal) => new Promise((_res, rej) => signal.addEventListener('abort', () => rej(new Error('stopped')))) });
    await t.run('reviseStoryboard', { ops: add(3) });
    await t.run('dispatch', { kind: 'build-scene', sceneId: 's3', brief: 'b', reason: 'r' });
    await settle();
    expect(t.board.get('j1')!.status).toBe('running');
    const r = await t.run('reviseStoryboard', { ops: [{ op: 'remove', sceneId: 's3' }] });
    expect(r.ok).toBe(true);
    expect(t.board.get('j1')!.status).toBe('cancelled');
  });
});

describe('dispatch, cancel, pickTake, proposeGenerate', () => {
  it('starts a job for a scene that exists and records it for this turn', async () => {
    const t = await setup();
    await t.run('reviseStoryboard', { ops: add(2) });
    const r = await t.run('dispatch', { kind: 'build-scene', sceneId: 's1', brief: 'build it', reason: 'new' });
    expect(r).toMatchObject({ ok: true, data: { jobIds: ['j1'] } });
    expect(t.board.get('j1')).toMatchObject({ kind: 'build-scene', sceneId: 's1', origin: 'showrunner' });
    expect(t.crew.turn.dispatched.has('s1')).toBe(true);
  });

  it('names an unknown scene', async () => {
    const t = await setup();
    await t.run('reviseStoryboard', { ops: add(2) });
    expect(await t.run('dispatch', { kind: 'build-scene', sceneId: 's9', brief: 'b', reason: 'r' })).toEqual({ ok: false, error: 'unknown scene s9' });
  });

  it('allows three showrunner fixes on one scene, then refuses the fourth, but not a fix on another', async () => {
    const t = await setup();
    await t.run('reviseStoryboard', { ops: add(2) });
    const fix = (sceneId: string) => t.run('dispatch', { kind: 'fix', sceneId, brief: 'b', reason: 'r' });
    for (let i = 0; i < 3; i++) expect((await fix('s1')).ok).toBe(true);
    const fourth = await fix('s1');
    expect(!fourth.ok && fourth.error).toContain('fix cap reached for s1');
    expect((await fix('s2')).ok).toBe(true);
  });

  it('a writing kind with no scene is refused', async () => {
    const t = await setup();
    expect((await t.run('dispatch', { kind: 'restyle-scene', brief: 'b', reason: 'r' })).ok).toBe(false);
  });

  it('four takes is refused naming CREW_TAKES_MAX, and two or three make that many jobs', async () => {
    const t = await setup();
    await t.run('reviseStoryboard', { ops: add(2) });
    const bad = await t.run('dispatch', { kind: 'take', sceneId: 's1', takes: 4, brief: 'b', reason: 'r' });
    expect(!bad.ok && bad.error).toContain('CREW_TAKES_MAX');
    const good = await t.run('dispatch', { kind: 'take', sceneId: 's1', takes: 3, brief: 'b', reason: 'r' });
    expect(good).toMatchObject({ ok: true, data: { jobIds: ['j1', 'j2', 'j3'] } });
    expect(t.board.list().map((j) => j.takeLabel)).toEqual(['A', 'B', 'C']);
  });

  it('an unknown dependsOn is refused', async () => {
    const t = await setup();
    await t.run('reviseStoryboard', { ops: add(2) });
    expect((await t.run('dispatch', { kind: 'critique', sceneId: 's1', brief: 'b', reason: 'r', dependsOn: ['j9'] })).ok).toBe(false);
  });

  it('cancel ends a running job cancelled and returns ok', async () => {
    const t = await setup({ runWorker: (_job, signal) => new Promise((_res, rej) => signal.addEventListener('abort', () => rej(new Error('stopped')))) });
    await t.run('reviseStoryboard', { ops: add(2) });
    await t.run('dispatch', { kind: 'build-scene', sceneId: 's1', brief: 'b', reason: 'r' });
    await settle();
    expect(await t.run('cancel', { jobId: 'j1' })).toMatchObject({ ok: true, data: { status: 'cancelled' } });
    expect(t.board.get('j1')!.status).toBe('cancelled');
    expect((await t.run('cancel', { jobId: 'j1' })).ok).toBe(false);
    expect((await t.run('cancel', { jobId: 'j9' })).ok).toBe(false);
  });

  it('pickTake delegates to the takes module, and says so when there is none', async () => {
    const t = await setup();
    expect((await t.run('pickTake', { takeFilmId: 'film_bbbbbbbbbbbb' })).ok).toBe(false);
    t.crew.takes = { pick: async (a) => ({ ok: true, data: a }) };
    expect(await t.run('pickTake', { takeFilmId: 'film_bbbbbbbbbbbb', reason: 'bolder' })).toMatchObject({ ok: true, data: { takeFilmId: 'film_bbbbbbbbbbbb' } });
  });

  it('proposeGenerate switches the scene to generate and runs the propose step', async () => {
    const t = await setup();
    await t.run('reviseStoryboard', { ops: add(3) });
    const proposed: string[] = [];
    t.crew.propose = async (id) => (proposed.push(id), { ok: true });
    const r = await t.run('proposeGenerate', { sceneId: 's2', reason: 'the pour needs real motion' });
    expect(r.ok).toBe(true);
    expect(proposed).toEqual(['s2']);
    const film = await t.film.films.get(t.film.filmId);
    expect(film.storyboard?.scenes.find((s) => s.id === 's2')).toMatchObject({ mode: 'generate', modeReason: 'the pour needs real motion' });
    expect((film.composition?.meta as { director: { scenes: Record<string, { mode: string }> } }).director.scenes.s2!.mode).toBe('generate');
  });

  it('proposeGenerate refuses a third generate scene and an unknown scene', async () => {
    const t = await setup();
    await t.run('reviseStoryboard', { ops: add(4) });
    t.crew.propose = async () => ({ ok: true });
    await t.run('proposeGenerate', { sceneId: 's1', reason: 'r' });
    await t.run('proposeGenerate', { sceneId: 's2', reason: 'r' });
    expect(await t.run('proposeGenerate', { sceneId: 's3', reason: 'r' })).toMatchObject({ ok: false });
    expect(await t.run('proposeGenerate', { sceneId: 's9', reason: 'r' })).toEqual({ ok: false, error: 'unknown scene s9' });
  });
});

describe('say, ask, finish', () => {
  it('say is a note, and a reply in a turn that had a user item', async () => {
    const t = await setup();
    await t.run('say', { text: 'Four scenes.' });
    t.crew.turn.hadUser = true;
    await t.run('say', { text: 'On it.' });
    await settle();
    expect(t.events.filter((e) => e.type === 'showrunner.say').map((e) => (e as { kind: string }).kind)).toEqual(['note', 'reply']);
  });

  it('ask carries its options', async () => {
    const t = await setup();
    await t.run('ask', { question: 'Warmer or cooler?', options: ['Warmer', 'Cooler'] });
    await settle();
    expect(t.events.find((e) => e.type === 'showrunner.say')).toMatchObject({ kind: 'ask', text: 'Warmer or cooler?', options: ['Warmer', 'Cooler'] });
    expect((await t.run('ask', { question: 'q', options: ['only one'] })).ok).toBe(false);
  });

  it('finish is refused while a job is open, naming it', async () => {
    const t = await setup({ runWorker: (_job, signal) => new Promise((_res, rej) => signal.addEventListener('abort', () => rej(new Error('stopped')))) });
    await t.run('reviseStoryboard', { ops: add(2) });
    t.board.add({ kind: 'build-scene', origin: 'auto', sceneId: 's1' });
    t.board.add({ kind: 'build-scene', origin: 'auto', sceneId: 's2' });
    t.board.update('j1', { status: 'running' });
    t.board.update('j1', { status: 'done' });
    t.board.update('j2', { status: 'running' });
    expect(await t.run('finish', { summary: 'done' })).toEqual({ ok: false, error: 'jobs still running: j2' });
  });

  it('finish is refused when the rules report an error, naming the rule', async () => {
    const t = await setup();
    await t.run('reviseStoryboard', { ops: add(2) });
    t.crew.extraChecks = async () => [{ kind: 'text-off-frame', sceneId: 's2' }];
    const r = await t.run('finish', { summary: 'done' });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain('text-off-frame');
    expect((await t.film.films.get(t.film.filmId)).status).not.toBe('ready');
  });

  it('finish waits for a safe-area finding until the fix cap is spent, then accepts it', async () => {
    const t = await setup();
    await t.run('reviseStoryboard', { ops: add(2) });
    await t.film.films.mutate(t.film.filmId, (f) => {
      let c = addLayer(f.composition as Comp, { sceneId: 's1', role: 'headline', kind: 'text', text: 'Hello there' });
      c = setTransform(c, 's1:headline', { x: 1900, y: 1070 });
      return { next: c, data: null };
    }, 'director');
    const blocked = await t.run('finish', { summary: 'done' });
    expect(!blocked.ok && blocked.error).toContain('outside-safe-area (s1)');
    expect((await t.film.films.get(t.film.filmId)).status).not.toBe('ready');
    for (let i = 0; i < 3; i++) {
      const j = t.board.add({ kind: 'fix', origin: 'showrunner', sceneId: 's1', brief: 'b', reason: 'r' });
      t.board.update(j.id, { status: 'running' });
      t.board.update(j.id, { status: 'done' });
    }
    const r = await t.run('finish', { summary: 'done' });
    expect(r.ok).toBe(true);
    expect((await t.film.films.get(t.film.filmId)).status).toBe('ready');
    await settle();
    expect(t.events.find((e) => e.type === 'showrunner.say')).toMatchObject({ text: 'done accepted: s1 outside-safe-area (3 fixes tried)' });
  });

  it('finish with nothing open and no errors makes the film ready', async () => {
    const t = await setup();
    await t.run('reviseStoryboard', { ops: add(2) });
    expect((await t.run('finish', { summary: 'Two scenes, done.' })).ok).toBe(true);
    expect((await t.film.films.get(t.film.filmId)).status).toBe('ready');
    await settle();
    expect(t.events.find((e) => e.type === 'film.status')).toMatchObject({ status: 'ready' });
  });

  it('finish commits the polish: a grade on each scene and the music bed', async () => {
    const t = await setup();
    await t.run('reviseStoryboard', { ops: add(2) });
    expect((await t.run('finish', { summary: 'done' })).ok).toBe(true);
    const c = (await t.film.films.get(t.film.filmId)).composition as Comp;
    expect(JSON.stringify(c.precomps)).toContain('finish:s1:grade');
    expect(JSON.stringify(c.layers)).toContain('finish:music');
  });
});
