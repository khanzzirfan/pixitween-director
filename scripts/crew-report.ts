// Owned by S12e. Prints the crew's measured numbers from a film's event log, so the README and the video quote facts.
// `npx tsx scripts/crew-report.ts <events.jsonl | film-id> [--json] [--data DIR]`
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Job } from '../shared/crew';
import type { FilmEvent } from '../shared/events';

export interface CrewReport {
  filmId: string;
  events: number;
  /** Seconds from the first event to the first time the film is ready; null when it never was. */
  wallToReadySec: number | null;
  /** Seconds from the first event to the last one. */
  totalSec: number;
  peakParallelWorkers: number;
  jobs: { total: number; byStatus: Record<string, number>; byKind: Record<string, number> };
  showrunnerTurns: number;
  toolCalls: { total: number; ok: number; firstTryValidPct: number | null };
  findings: { total: number; rules: number; critic: number };
  storyboardRevisions: { total: number; bySource: Record<string, number> };
  userMessages: number;
  takes: number;
  costUsd: number;
  costByModel: Record<string, number>;
}

/** Reads a log in either shape: `{seq, event}` lines or bare events. */
export function parseLog(text: string): FilmEvent[] {
  return text
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => {
      const v = JSON.parse(l) as { event?: FilmEvent } & FilmEvent;
      return v.event ?? v;
    });
}

const ms = (iso: string) => Date.parse(iso);
const bump = (m: Record<string, number>, k: string, by = 1) => void (m[k] = (m[k] ?? 0) + by);

/** The most jobs running at the same moment, from each job's own start and end times. */
export function peakParallel(jobs: readonly Job[]): number {
  const edges: Array<[number, number]> = [];
  for (const j of jobs) {
    if (!j.startedAt || !j.endedAt) continue;
    edges.push([ms(j.startedAt), 1], [ms(j.endedAt), -1]);
  }
  // an end at the same instant as a start frees its place first
  edges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let now = 0;
  let peak = 0;
  for (const [, d] of edges) peak = Math.max(peak, (now += d));
  return peak;
}

export function buildReport(events: readonly FilmEvent[]): CrewReport {
  const first = events[0] ? ms(events[0].at) : 0;
  const last = events.at(-1) ? ms(events.at(-1)!.at) : 0;
  const ready = events.find((e) => e.type === 'film.status' && e.status === 'ready');
  const latest = new Map<string, Job>();
  const byModel: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  const r: CrewReport = {
    filmId: events[0]?.filmId ?? '',
    events: events.length,
    wallToReadySec: ready ? (ms(ready.at) - first) / 1000 : null,
    totalSec: (last - first) / 1000,
    peakParallelWorkers: 0,
    jobs: { total: 0, byStatus: {}, byKind: {} },
    showrunnerTurns: 0,
    toolCalls: { total: 0, ok: 0, firstTryValidPct: null },
    findings: { total: 0, rules: 0, critic: 0 },
    storyboardRevisions: { total: 0, bySource },
    userMessages: 0,
    takes: 0,
    costUsd: 0,
    costByModel: byModel,
  };
  for (const e of events) {
    switch (e.type) {
      case 'job.update':
        latest.set(e.job.id, e.job);
        break;
      case 'agent.turn':
        if (e.backend === 'wonder') r.showrunnerTurns++;
        break;
      case 'tool.call':
        r.toolCalls.total++;
        if (e.ok) r.toolCalls.ok++;
        break;
      case 'review.finding':
        r.findings.total++;
        r.findings[e.deterministic ? 'rules' : 'critic']++;
        break;
      case 'storyboard.revised':
        r.storyboardRevisions.total++;
        bump(bySource, e.source);
        break;
      case 'showrunner.heard':
        if (e.from === 'user') r.userMessages++;
        break;
      case 'take.ready':
        r.takes++;
        break;
      case 'cost':
        r.costUsd += e.usd;
        bump(byModel, e.model, e.usd);
        break;
    }
  }
  const jobs = [...latest.values()];
  r.jobs.total = jobs.length;
  for (const j of jobs) {
    bump(r.jobs.byStatus, j.status);
    bump(r.jobs.byKind, j.kind);
  }
  r.peakParallelWorkers = peakParallel(jobs);
  if (r.toolCalls.total) r.toolCalls.firstTryValidPct = Math.round((r.toolCalls.ok / r.toolCalls.total) * 1000) / 10;
  r.costUsd = Math.round(r.costUsd * 1e6) / 1e6;
  return r;
}

const fmt = (n: number | null, unit = '') => (n === null ? 'not reached' : `${Math.round(n * 10) / 10}${unit}`);
const dist = (m: Record<string, number>) => Object.entries(m).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k} ${v}`).join(', ') || 'none';

export function formatReport(r: CrewReport): string {
  return [
    `Crew report for ${r.filmId} (${r.events} events)`,
    `Wall time to ready: ${fmt(r.wallToReadySec, ' s')} (whole log ${fmt(r.totalSec, ' s')})`,
    `Peak parallel workers: ${r.peakParallelWorkers}`,
    `Jobs: ${r.jobs.total} (${dist(r.jobs.byKind)}); ${dist(r.jobs.byStatus)}`,
    `Showrunner turns: ${r.showrunnerTurns}; your messages: ${r.userMessages}`,
    `Tool calls: ${r.toolCalls.ok} of ${r.toolCalls.total} valid${r.toolCalls.firstTryValidPct === null ? '' : ` (${r.toolCalls.firstTryValidPct}%)`}`,
    `Findings: ${r.findings.total} (${r.findings.rules} by rules, ${r.findings.critic} by the critic)`,
    `Storyboard revisions: ${r.storyboardRevisions.total} (${dist(r.storyboardRevisions.bySource)})`,
    `Takes made: ${r.takes}`,
    `Cost: $${r.costUsd.toFixed(4)} (${Object.entries(r.costByModel).map(([m, v]) => `${m} $${v.toFixed(4)}`).join(', ') || 'none'})`,
  ].join('\n');
}

/** A path to a log, or a film id looked up in the data dir. */
export function resolveLog(arg: string, dataDir: string): string {
  if (existsSync(arg)) return arg;
  const byId = join(dataDir, 'films', arg, 'events.jsonl');
  if (existsSync(byId)) return byId;
  throw new Error(`no log at ${arg} or ${byId}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2);
  const flag = (n: string) => args.includes(n);
  const di = args.indexOf('--data');
  const data = resolve(di >= 0 ? (args[di + 1] ?? './data') : (process.env.DATA_DIR ?? './data'));
  const target = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--data');
  if (!target) {
    console.log('usage: tsx scripts/crew-report.ts <events.jsonl | film-id> [--json] [--data DIR]');
    process.exit(1);
  }
  const report = buildReport(parseLog(readFileSync(resolveLog(target, data), 'utf8')));
  console.log(flag('--json') ? JSON.stringify(report, null, 2) : formatReport(report));
}
