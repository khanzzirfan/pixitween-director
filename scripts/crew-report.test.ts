import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import type { Job } from '../shared/crew';
import { buildReport, formatReport, parseLog, peakParallel } from './crew-report';

const demo = new URL('../fixtures/s12e/demo-film/events.jsonl', import.meta.url).pathname;
const events = parseLog(readFileSync(demo, 'utf8'));

it("prints 'Peak parallel workers: 4' for the fake run with 4 overlapping builds", () => {
  expect(formatReport(buildReport(events))).toContain('Peak parallel workers: 4');
});

it('counts what the log holds: a user edit, three takes, a wall time and a cost', () => {
  const r = buildReport(events);
  expect(r.storyboardRevisions.bySource['user']).toBe(1);
  expect(r.takes).toBe(3);
  expect(r.userMessages).toBeGreaterThanOrEqual(2);
  expect(r.wallToReadySec).toBeGreaterThan(0);
  expect(r.costUsd).toBeGreaterThan(0);
  expect(r.jobs.byKind['build-scene']).toBeGreaterThanOrEqual(5);
  expect(Object.values(r.jobs.byStatus).reduce((a, b) => a + b, 0)).toBe(r.jobs.total);
});

it('--json parses and has numeric wallToReadySec and costUsd', () => {
  const out = execFileSync('npx', ['tsx', 'scripts/crew-report.ts', demo, '--json'], { encoding: 'utf8' });
  const r = JSON.parse(out) as { wallToReadySec: unknown; costUsd: unknown };
  expect(typeof r.wallToReadySec).toBe('number');
  expect(typeof r.costUsd).toBe('number');
}, 30_000);

it('peakParallel lets an end and a start at the same instant share one place', () => {
  const j = (a: string, b: string) => ({ startedAt: a, endedAt: b }) as Job;
  expect(peakParallel([j('2026-10-30T10:00:00Z', '2026-10-30T10:00:05Z'), j('2026-10-30T10:00:05Z', '2026-10-30T10:00:09Z')])).toBe(1);
  expect(peakParallel([j('2026-10-30T10:00:00Z', '2026-10-30T10:00:05Z'), j('2026-10-30T10:00:04Z', '2026-10-30T10:00:09Z')])).toBe(2);
  expect(peakParallel([])).toBe(0);
});

it('an empty log and a film that never got ready still report', () => {
  const r = buildReport([]);
  expect(r.wallToReadySec).toBeNull();
  expect(formatReport(r)).toContain('not reached');
});

it('reads bare events as well as {seq, event} lines', () => {
  expect(parseLog('{"filmId":"f","at":"2026-10-30T10:00:00Z","type":"film.status","status":"planning"}\n')).toHaveLength(1);
});
