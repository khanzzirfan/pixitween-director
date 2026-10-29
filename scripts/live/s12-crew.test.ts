import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { filmEventSchema } from '../../shared/events';
import * as crew from './s12-crew';

const events = (JSON.parse(readFileSync(new URL('../../fixtures/s12b/events-midbuild.json', import.meta.url), 'utf8')) as unknown[]).map((e) => filmEventSchema.parse(e));

it('estimates $1 for one crew film and $3 for the comparison', () => {
  expect(crew.estimateUsd([])).toBe(1);
  expect(crew.estimateUsd()).toBe(1);
  expect(crew.estimateUsd(['--ab'])).toBe(3);
  expect(crew.describe()).toContain(crew.MID_BUILD_MESSAGE);
});

it('reads the metrics from the event log', () => {
  const m = crew.computeMetrics(events);
  expect(m.wallTimeSec).toBe(70); // 14:00:00 to 14:01:10
  expect(m.showrunnerTurns).toBe(1);
  expect(m.jobsByKind).toEqual({ 'build-scene': 5, 'restyle-scene': 1 });
  expect(m.superseded).toBe(1);
  expect(m.toolCalls).toBe(3);
  expect(m.toolCallsOk).toBe(2);
  expect(m.findings).toBe(1);
  expect(m.costUsd).toBeCloseTo(0.09, 6);
  expect(m.scenes).toBe(5);
  expect(m.hasNewScene).toBe(true);
});

it('prints a Wall time row and a Cost per film row with values from the log', () => {
  const table = crew.renderTable([{ name: 'Crew + Wonder', metrics: crew.computeMetrics(events) }]);
  expect(table).toMatch(/^\| Wall time to a finished film \| 70\.0 s \|$/m);
  expect(table).toMatch(/^\| Cost per film \| \$0\.09 \|$/m);
  expect(table).toMatch(/^\| Valid tool calls on first try \| 67 % \|$/m);
  expect(table).toContain('Scenes in the final film | 5 (new scene added)');
});

it('lines up one column per arrangement', () => {
  const m = crew.computeMetrics(events);
  const table = crew.renderTable([{ name: 'A', metrics: m }, { name: 'B', metrics: { ...m, costUsd: 0.5 } }]);
  expect(table.split('\n')[0]).toBe('| Metric | A | B |');
  expect(table).toMatch(/^\| Cost per film \| \$0\.09 \| \$0\.50 \|$/m);
});
