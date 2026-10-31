import { describe, expect, it } from 'vitest';
import { makeTestCrew, waitFor } from '../crew/test-helpers';
import { runCriticJob } from '../crew/workers/critic';
import { addLayer, addScene, newFilmComposition, registerAsset } from '../authoring/api';
import type { Comp } from '../authoring/types';
import { COVER_LIMIT, project, sceneHasStage, stageFindings, stageFindingsAt, STAGE_VISION_QUESTIONS } from './checks';
import { addStage, moveActor, placeActor, placeProduct3D, placeProp, type Mark } from './stage-api';

function stage(): Comp {
  let c: Comp = newFilmComposition({ aspect: '16:9', title: 'Pip', palette: ['#111827'] });
  c = registerAsset(c, { id: 'pip', kind: 'model', src: '/cartoon/toy-character.glb' });
  c = addScene(c, { id: 's1', durationSec: 4, mode: 'motion' });
  c = addLayer(c, { sceneId: 's1', role: 'bg', kind: 'shape', fill: '#f4ead5' });
  return addStage(c, 's1');
}
const withActor = (c: Comp, id: string, mark: Mark, o = {}) => placeActor(c, 's1', id, 'pip', mark, o);

describe('stage checks', () => {
  it('projects the middle of the stage to the middle of the frame, and a far-off point out of it', () => {
    const cam = { position: [0, 1.4, 6] as [number, number, number], target: [0, 0.9, 0] as [number, number, number], fov: 35 };
    const mid = project(cam, 16 / 9, [0, 0.9, 0])!;
    expect(Math.abs(mid.x)).toBeLessThan(1e-9);
    expect(Math.abs(mid.y)).toBeLessThan(1e-9);
    expect(Math.abs(project(cam, 16 / 9, [4, 0, 0])!.x)).toBeGreaterThan(1);
    expect(Math.abs(project(cam, 16 / 9, [1.5, 0, 0])!.x)).toBeLessThan(1);
    expect(project(cam, 16 / 9, [0, 0, 8])).toBeUndefined(); // behind the camera
  });

  it('has nothing to say about a scene without a stage', () => {
    const c = newFilmComposition({ aspect: '16:9', title: 'x', palette: ['#111827'] });
    expect(sceneHasStage(c, 's1')).toBe(false);
    expect(stageFindingsAt(addScene(c, { id: 's1', durationSec: 4, mode: 'motion' }), 's1', 1)).toEqual([]);
  });

  it("an actor marked at x = 4 gets one 'actor-off-frame', and one on the grid gets none", () => {
    const off = stageFindings(withActor(stage(), 'pip', [4, 0, 0]), 's1', [0.8, 2, 3.2]);
    expect(off).toHaveLength(1);
    expect(off[0]).toMatchObject({ kind: 'actor-off-frame', rule: 'S1', sceneId: 's1', layerId: 's1:pip', severity: 'error' });
    expect(off[0]!.samplesFailing).toEqual([0.8, 2, 3.2]);
    expect(off[0]!.evidence).toMatch(/pip/);
    for (const x of [-1.5, 0, 1.5]) expect(stageFindings(withActor(stage(), 'pip', [x, 0, 0]), 's1', [2])).toEqual([]);
  });

  it('an actor who walks off screen is caught only at the times he is out', () => {
    let c = withActor(stage(), 'pip', [0, 0, 0]);
    c = moveActor(c, 's1', 'pip', [5, 0, 90], 60, 30); // frames 60 to 90 = 2 s to 3 s
    expect(stageFindings(c, 's1', [0.8, 1.5])).toEqual([]);
    expect(stageFindings(c, 's1', [3.2])[0]).toMatchObject({ kind: 'actor-off-frame', atSec: 3.2 });
  });

  it("an actor in front of the product covering more than 40% of it gets one 'product-covered' naming the actor", () => {
    let c = withActor(stage(), 'pip', [0.1, 1, 0]);
    c = placeProduct3D(c, 's1', 'can', { shape: 'can', size: 0.3, position: [0, 0, 0] });
    const f = stageFindings(c, 's1', [2]);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ kind: 'product-covered', rule: 'S2', layerId: 's1:can' });
    expect(f[0]!.evidence).toMatch(/pip covers \d+% of the product/);
    expect(Number(f[0]!.metrics.covered)).toBeGreaterThan(COVER_LIMIT);
  });

  it('an actor behind the product, beside it, or too small a share does not cover it', () => {
    const can = (c: Comp) => placeProduct3D(c, 's1', 'can', { shape: 'can', size: 0.3, position: [0, 0, 0] });
    expect(stageFindings(can(withActor(stage(), 'pip', [0, -1, 0])), 's1', [2])).toEqual([]); // behind
    expect(stageFindings(can(withActor(stage(), 'pip', [1.5, 1, 0])), 's1', [2])).toEqual([]); // beside
    // a held product is the actor's own, never covered by it
    let c = withActor(stage(), 'pip', [0, 1, 0]);
    c = placeProduct3D(c, 's1', 'held', { shape: 'can', size: 0.2, attach: { actor: 'pip', bone: 'RightHand' } });
    expect(stageFindings(c, 's1', [2])).toEqual([]);
  });

  it('two actors closer than 0.6 m are reported once, and at 1.5 m apart are not', () => {
    const c = withActor(withActor(stage(), 'a', [0, 0, 0]), 'b', [0.4, 0, 0]);
    const f = stageFindings(c, 's1', [1, 2]);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ kind: 'actors-too-close', rule: 'S3', severity: 'warn' });
    expect(f[0]!.samplesFailing).toEqual([1, 2]);
    expect(stageFindings(withActor(withActor(stage(), 'a', [-0.75, 0, 0]), 'b', [0.75, 0, 0]), 's1', [2])).toEqual([]);
  });

  it('skips an actor that is not on stage yet', () => {
    const c = withActor(stage(), 'late', [4, 0, 0], { inFrame: 90 });
    expect(stageFindings(c, 's1', [1])).toEqual([]);
    expect(stageFindings(c, 's1', [3.5])).toHaveLength(1);
  });

  it("a big prop standing in front of an actor gets 'actor-hidden' naming the prop; a small one beside does not", () => {
    const c = placeProp(withActor(stage(), 'pip', [0, 0, 0]), 's1', 'rug', { shape: 'box', size: 1.2, position: [0, 0, 1.5] });
    const f = stageFindings(c, 's1', [2]);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ kind: 'actor-hidden', rule: 'S4', layerId: 's1:pip', severity: 'error' });
    expect(f[0]!.evidence).toMatch(/rug hides \d+% of pip/);
    expect(stageFindings(placeProp(withActor(stage(), 'pip', [0, 0, 0]), 's1', 'crate', { shape: 'box', size: 0.3, position: [1.5, 0, 0] }), 's1', [2])).toEqual([]);
  });

  it('gives a model prop with no size a hand-sized default, and caps it', () => {
    const layer = (c: Comp) => ((c.precomps as Record<string, { layers: Array<Record<string, unknown>> }>).s1!.layers).find((l) => l.id === 's1:crate')!;
    expect(layer(placeProp(stage(), 's1', 'crate', { shape: 'box' })).size).toBe(0.3);
    expect(layer(placeProp(stage(), 's1', 'crate', { shape: 'box', size: 9 })).size).toBe(1.2);
  });

  it('asks the vision review about bodies through objects, the product and cut-off characters', () => {
    expect(STAGE_VISION_QUESTIONS.join(' ')).toMatch(/passing through[\s\S]*product[\s\S]*cut off/);
  });
});

describe('the critic on a toy-studio scene', () => {
  it('reports a stage fault from the rules even with no browser, as one inbox item and a deterministic finding', async () => {
    const t = await makeTestCrew();
    await t.film.films.commit(t.film.filmId, withActor(stage(), 'pip', [4, 0, 0]), 'director');
    const job = t.board.add({ kind: 'critique', origin: 'auto', sceneId: 's1', brief: 'review s1', reason: 'r' });
    t.board.update(job.id, { status: 'running' });
    const r = await runCriticJob(job, new AbortController().signal, t.crew, { timeoutMs: 20 });
    expect(r.summary).toBe('no browser connected; rules only');
    await waitFor(() => t.events.some((e) => e.type === 'review.finding'));
    const finding = t.events.find((e) => e.type === 'review.finding' && e.kind === 'actor-off-frame');
    expect(finding).toMatchObject({ sceneId: 's1', deterministic: true });
    const [item] = await t.inbox.drain();
    expect(item!.text).toMatch(/s1 at \d(\.\d+)?s actor-off-frame: pip/);
  });
});
