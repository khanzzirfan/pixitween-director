import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoryboardOp } from '@shared/crew';
import type { Scene } from '@shared/storyboard';
import type { ToolDef } from '@shared/tools';
import { makeTestCrew } from './test-helpers';

const cut = vi.hoisted(() => ({ calls: 0, release: undefined as (() => void) | undefined }));
vi.mock('./cinematic-cut', () => ({
  cinematicCut: async () => {
    cut.calls++;
    await new Promise<void>((r) => (cut.release = r));
    return false;
  },
}));

import { createBoardTools, finishFilm } from './showrunner-tools';

const scene: Omit<Scene, 'id'> = { durationSec: 4, intent: 'a scene', shotType: 'hero', camera: 'static', layersWanted: ['bg', 'product'], mode: 'motion', modeReason: 'a still is enough' };
const add = (n = 1): StoryboardOp[] => Array.from({ length: n }, () => ({ op: 'add' as const, scene }));

// a film with two scenes planned, so the finish gate passes
async function built() {
  const t = await makeTestCrew({});
  const tools = createBoardTools(t.crew);
  const def = tools.find((d: ToolDef) => d.name === 'reviseStoryboard')!;
  expect((await def.run(t.film.ctx, def.params.parse({ ops: add(2) }))).ok).toBe(true);
  return t;
}

describe('the finish runs once per film', () => {
  // the test setup turns the cinematic cut off; this file is about the cut, which is mocked
  let was: string | undefined;
  beforeAll(() => {
    was = process.env.CINEMATIC_CUT;
    delete process.env.CINEMATIC_CUT;
  });
  afterAll(() => {
    if (was !== undefined) process.env.CINEMATIC_CUT = was;
  });
  beforeEach(() => {
    cut.calls = 0;
  });

  it('joins a finish that is already running instead of making the cinematic cut again', async () => {
    const t = await built();
    const a = finishFilm(t.crew, t.film.ctx, 'first');
    const b = finishFilm(t.crew, t.film.ctx, 'second (out of time)', { force: true });
    await vi.waitFor(() => expect(cut.calls).toBeGreaterThan(0));
    cut.release!();
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.ok).toBe(true);
    expect(rb).toEqual(ra);
    expect(cut.calls).toBe(1);
  });

  it('gives a finish made after one completed its result while the film is unchanged, and runs again once it has changed', async () => {
    const t = await built();
    const first = finishFilm(t.crew, t.film.ctx, 'first');
    await vi.waitFor(() => expect(cut.calls).toBe(1));
    cut.release!();
    const r1 = await first;
    expect(r1.ok).toBe(true);
    expect(await finishFilm(t.crew, t.film.ctx, 'again')).toEqual(r1);
    expect(cut.calls).toBe(1);
    // an edit moves the film on: a later finish is a new one
    const def = createBoardTools(t.crew).find((d: ToolDef) => d.name === 'reviseStoryboard')!;
    await def.run(t.film.ctx, def.params.parse({ ops: add(1) }));
    const next = finishFilm(t.crew, t.film.ctx, 'after an edit');
    await vi.waitFor(() => expect(cut.calls).toBe(2));
    cut.release!();
    expect((await next).ok).toBe(true);
  });
});
