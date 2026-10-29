import { describe, expect, it } from 'vitest';
import type { JobStatus } from '@shared/crew';
import { JobTransitionError, TRANSITIONS } from './board';
import { makeTestBoard } from './test-helpers';

const build = { kind: 'build-scene', origin: 'auto', sceneId: 's1', brief: 'build it', reason: 'new scene' } as const;

describe('board', () => {
  it('numbers jobs j1, j2 and announces each with the full job', () => {
    const { board, updates } = makeTestBoard();
    expect(board.add(build).id).toBe('j1');
    expect(board.add({ ...build, sceneId: 's2' }).id).toBe('j2');
    expect(updates).toHaveLength(2);
    expect(updates[1]).toMatchObject({ id: 'j2', status: 'queued', sceneId: 's2', brief: 'build it', costUsd: 0, filmId: 'film_aaaaaaaaaaaa' });
  });

  it('refuses queued -> done and names the transition; nothing changes or is announced', () => {
    const { board, updates } = makeTestBoard();
    board.add(build);
    expect(() => board.update('j1', { status: 'done' })).toThrow(JobTransitionError);
    expect(() => board.update('j1', { status: 'done' })).toThrow(/queued to done/);
    expect(board.get('j1')!.status).toBe('queued');
    expect(updates).toHaveLength(1);
  });

  it('follows the table: every listed transition is accepted and every other one refused', () => {
    const all = Object.keys(TRANSITIONS) as JobStatus[];
    const path: Record<JobStatus, JobStatus[]> = {
      queued: [], running: ['running'], 'awaiting-frames': ['running', 'awaiting-frames'],
      done: ['running', 'done'], failed: ['running', 'failed'], cancelled: ['cancelled'], superseded: ['superseded'],
    };
    for (const from of all) {
      for (const to of all) {
        if (from === to) continue;
        const { board } = makeTestBoard();
        board.add(build);
        for (const step of path[from]) board.update('j1', { status: step });
        const ok = TRANSITIONS[from].includes(to);
        expect(() => board.update('j1', { status: to }), `${from} -> ${to}`).toSatisfy((fn: () => void) => {
          try {
            fn();
            return ok;
          } catch {
            return !ok;
          }
        });
      }
    }
  });

  it('stamps startedAt, endedAt and ms', () => {
    const { board, advance } = makeTestBoard();
    board.add(build);
    advance(1000);
    board.update('j1', { status: 'running', worker: 'builder-1' });
    advance(2500);
    const done = board.update('j1', { status: 'done', summary: 'ok' });
    expect(done).toMatchObject({ status: 'done', worker: 'builder-1', summary: 'ok', ms: 2500 });
    expect(done.startedAt).toBe('2026-10-30T00:00:01.000Z');
    expect(done.endedAt).toBe('2026-10-30T00:00:03.500Z');
  });

  it('a patch with no status change is announced too, and works on a finished job', () => {
    const { board, updates } = makeTestBoard();
    board.add(build);
    board.update('j1', { status: 'running' });
    board.update('j1', { status: 'done' });
    board.update('j1', { costUsd: 0.03 });
    expect(updates.at(-1)).toMatchObject({ status: 'done', costUsd: 0.03 });
  });

  it('returns copies, so a caller cannot edit the board', () => {
    const { board } = makeTestBoard();
    board.add(build);
    board.get('j1')!.status = 'done';
    board.list()[0]!.brief = 'x';
    expect(board.get('j1')).toMatchObject({ status: 'queued', brief: 'build it' });
  });

  it('an unknown job is an error', () => {
    expect(() => makeTestBoard().board.update('j9', { status: 'running' })).toThrow(/j9/);
  });

  it('a board reloaded from board.json has the same jobs and statuses, and numbering continues', async () => {
    const t = makeTestBoard();
    t.board.add(build);
    t.board.add({ ...build, sceneId: 's2' });
    t.board.update('j1', { status: 'running' });
    t.board.update('j1', { status: 'done' });
    await t.board.flush();
    const again = makeTestBoard({ dir: t.dir, initial: await t.persist.loadBoard() });
    expect(again.board.list().map((j) => [j.id, j.status])).toEqual([['j1', 'done'], ['j2', 'queued']]);
    expect(again.board.add(build).id).toBe('j3');
  });

  it('loading a film with no board gives an empty list', async () => {
    expect(await makeTestBoard().persist.loadBoard()).toEqual([]);
  });
});
