import { expect, it } from 'vitest';
import type { Metrics } from './s12-crew';
import * as gate from './s14-langgraph-gate';

const metrics = (o: Partial<Metrics>): Metrics => ({ wallTimeSec: 100, showrunnerTurns: 5, jobsByKind: {}, superseded: 0, toolCalls: 10, toolCallsOk: 10, findings: 0, costUsd: 0.4, scenes: 5, hasNewScene: true, ...o });

it('costs nothing offline and two films with --live', () => {
  expect(gate.estimateUsd([])).toBe(0);
  expect(gate.estimateUsd(['--live'])).toBe(2);
});

it('runs each offline gate once and reports a failing one', async () => {
  const seen: string[][] = [];
  const rows = await gate.runOffline(async (args) => {
    seen.push(args);
    return !args.includes('engine parity');
  });
  expect(seen).toHaveLength(5);
  expect(rows.map((r) => r.item)).toEqual([1, 2, 3, 4, 5]);
  expect(rows.filter((r) => !r.pass).map((r) => r.item)).toEqual([3]);
  expect(gate.renderGate(rows)).toContain('| 3 | same decisions on both engines | FAIL |');
  expect(gate.renderGate(rows)).toContain('not run (pass --live)');
});

it('passes a LangGraph run within 15 % of native and under the limits', () => {
  const checks = gate.liveVerdict(metrics({}), metrics({ wallTimeSec: 114, costUsd: 0.45 }));
  expect(checks.every((c) => c.pass)).toBe(true);
});

it('fails on time, cost, the $0.60 cap and the 4 minute cap', () => {
  const slow = gate.liveVerdict(metrics({ wallTimeSec: 100 }), metrics({ wallTimeSec: 116 }));
  expect(slow.find((c) => c.name.startsWith('time within'))?.pass).toBe(false);
  const dear = gate.liveVerdict(metrics({ costUsd: 0.4 }), metrics({ costUsd: 0.47 }));
  expect(dear.find((c) => c.name.startsWith('cost within'))?.pass).toBe(false);
  const capped = gate.liveVerdict(metrics({ wallTimeSec: 300, costUsd: 0.7 }), metrics({ wallTimeSec: 300, costUsd: 0.7 }));
  expect(capped.filter((c) => !c.pass).map((c) => c.name)).toEqual(['ready within 4 min', 'cost at most $0.60']);
});
