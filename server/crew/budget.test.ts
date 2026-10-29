import { describe, expect, it } from 'vitest';
import type { Job } from '@shared/crew';
import { createBudget, type BudgetLevel } from './budget';
import { createScheduler } from './scheduler';
import { makeTestBoard } from './test-helpers';

const job = (kind: Job['kind']) => ({ kind }) as Job;

function setup(capUsd = 1.0, spent: Record<string, number> = {}, children: string[] = []) {
  const events: Array<{ spentUsd: number; level: BudgetLevel }> = [];
  const notes: BudgetLevel[] = [];
  const budget = createBudget({
    ledger: { total: (id) => spent[id] ?? 0 },
    filmId: 'film_aaaaaaaaaaaa',
    childFilmIds: () => children,
    capUsd,
    emit: (e) => events.push(e),
    onLevel: (l) => notes.push(l),
  });
  return { budget, spent, events, notes };
}

describe('budget', () => {
  it('allows a build at 0.79 of 1.0 and stays ok; at 0.80 it warns once', () => {
    const { budget, spent, events } = setup(1.0, { film_aaaaaaaaaaaa: 0.79 });
    expect(budget.allows(job('build-scene'))).toBe(true);
    budget.check();
    expect(events).toEqual([]);
    spent.film_aaaaaaaaaaaa = 0.8;
    budget.check();
    budget.check();
    expect(events).toEqual([{ type: 'budget', spentUsd: 0.8, capUsd: 1, level: 'warn' }]);
  });

  it('refuses a take at 0.99 and a build at the cap, but a free job always runs', () => {
    const { budget } = setup(1.0, { film_aaaaaaaaaaaa: 0.99 });
    expect(budget.allows(job('take'))).toBe(false);
    expect(budget.allows(job('critique'))).toBe(true); // 0.99 + 0.01 reaches the cap exactly
    expect(budget.allows(job('continuity'))).toBe(true);
    expect(budget.allows(job('revert'))).toBe(true);
    const full = setup(1.0, { film_aaaaaaaaaaaa: 1.0 });
    expect(full.budget.allows(job('build-scene'))).toBe(false);
    expect(full.budget.allows(job('continuity'))).toBe(true);
  });

  it('announces warn then stop, each once, and tells onLevel', () => {
    const { budget, spent, events, notes } = setup(1.0);
    for (const usd of [0.5, 0.85, 0.9, 1.02, 1.1]) {
      spent.film_aaaaaaaaaaaa = usd;
      budget.check();
    }
    expect(events.map((e) => e.level)).toEqual(['warn', 'stop']);
    expect(notes).toEqual(['warn', 'stop']);
  });

  it('counts spend on a child film toward the parent', () => {
    const { budget, events } = setup(1.0, { film_aaaaaaaaaaaa: 0.4, film_bbbbbbbbbbbb: 0.25, film_cccccccccccc: 0.2 }, ['film_bbbbbbbbbbbb', 'film_cccccccccccc']);
    expect(budget.spent()).toBeCloseTo(0.85);
    budget.check();
    expect(events.map((e) => e.level)).toEqual(['warn']);
    expect(budget.allows(job('take'))).toBe(true);
    expect(budget.level()).toBe('warn');
  });

  it('knows the estimates of the design table', () => {
    const { budget } = setup();
    expect([budget.estimate(job('build-scene')), budget.estimate(job('restyle-scene')), budget.estimate(job('critique')), budget.estimate(job('take'))]).toEqual([0.03, 0.02, 0.01, 0.03]);
  });
});

describe('budget in the scheduler', () => {
  it('a job the budget refuses fails with error budget and never runs', async () => {
    const t = makeTestBoard();
    const { budget, events } = setup(1.0, { film_aaaaaaaaaaaa: 0.99 });
    let ran = 0;
    const s = createScheduler({ board: t.board, maxWorkers: 4, runWorker: async () => void ran++, budget });
    await s.dispatch({ kind: 'take', sceneId: 's1', origin: 'showrunner', brief: 'b', reason: 'r' });
    await s.idle();
    expect(t.board.get('j1')).toMatchObject({ status: 'failed', error: 'budget' });
    expect(ran).toBe(0);
    expect(events.map((e) => e.level)).toEqual(['warn']); // 0.99 of 1.0 is past the warning line, and check() runs after the refusal
  });

  it('a refused job does not hold back the next one', async () => {
    const t = makeTestBoard();
    const { budget } = setup(1.0, { film_aaaaaaaaaaaa: 0.99 });
    const ran: string[] = [];
    const s = createScheduler({ board: t.board, maxWorkers: 4, runWorker: async (j) => void ran.push(j.id), budget });
    await s.dispatch({ kind: 'take', sceneId: 's1', origin: 'showrunner', brief: 'b', reason: 'r' });
    await s.dispatch({ kind: 'continuity', sceneId: 's1', origin: 'auto', brief: 'b', reason: 'r' });
    await s.idle();
    expect(ran).toEqual(['j2']);
  });
});
