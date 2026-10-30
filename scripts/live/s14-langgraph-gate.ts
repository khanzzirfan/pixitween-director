import { spawn } from 'node:child_process';
import { buildDeps } from '../../server/main';
import { computeMetrics, crewFilm, type Metrics } from './s12-crew';
import type { LiveScript } from './run';

/** The offline checks of 10-langgraph-orchestration.md section 7, each a vitest run. */
export const OFFLINE_GATES: Array<{ item: number; name: string; args: string[] }> = [
  { item: 1, name: 'existing crew suite', args: ['server/crew', 'server/agent', 'shared'] },
  { item: 2, name: 'finish scenario, both engines', args: ['server/crew/finish.scenario.test.ts', '-t', 'finish scenario'] },
  { item: 3, name: 'same decisions on both engines', args: ['server/crew/finish.scenario.test.ts', '-t', 'engine parity'] },
  { item: 4, name: 'user message reaches the showrunner within 100 ms', args: ['server/crew/run-crew.test.ts', '-t', '100 ms'] },
  { item: 5, name: 'restart mid-build resumes', args: ['server/crew/run-crew.test.ts', '-t', 'stopped mid-build'] },
];

export type Exec = (args: string[]) => Promise<boolean>;

const vitest: Exec = (args) =>
  new Promise((resolve) => {
    const child = spawn('npx', ['vitest', 'run', ...args], { stdio: 'ignore' });
    child.on('exit', (code) => resolve(code === 0));
    child.on('error', () => resolve(false));
  });

export async function runOffline(exec: Exec = vitest): Promise<Array<{ item: number; name: string; pass: boolean }>> {
  const rows: Array<{ item: number; name: string; pass: boolean }> = [];
  for (const g of OFFLINE_GATES) rows.push({ item: g.item, name: g.name, pass: await exec(g.args) });
  return rows;
}

export interface Check {
  name: string;
  pass: boolean;
  detail: string;
}

/** Section 7 item 6: ready within 4 min and $0.60, and time and cost within 15 % of the native engine on the same brief. */
export function liveVerdict(native: Metrics, graph: Metrics): Check[] {
  const within = (a: number, b: number, slack: number) => a <= b * 1.15 + slack;
  return [
    { name: 'ready within 4 min', pass: graph.wallTimeSec <= 240, detail: `${graph.wallTimeSec.toFixed(0)} s` },
    { name: 'cost at most $0.60', pass: graph.costUsd <= 0.6, detail: `$${graph.costUsd.toFixed(2)}` },
    { name: 'time within 15 % of native', pass: within(graph.wallTimeSec, native.wallTimeSec, 0), detail: `${graph.wallTimeSec.toFixed(0)} s vs ${native.wallTimeSec.toFixed(0)} s` },
    { name: 'cost within 15 % of native', pass: within(graph.costUsd, native.costUsd, 0.005), detail: `$${graph.costUsd.toFixed(2)} vs $${native.costUsd.toFixed(2)}` },
    { name: 'the new scene was added', pass: graph.hasNewScene, detail: graph.hasNewScene ? 'yes' : 'no' },
  ];
}

export function renderGate(offline: Array<{ item: number; name: string; pass: boolean }>, live?: Check[]): string {
  const rows = [
    ...offline.map((r) => `| ${r.item} | ${r.name} | ${r.pass ? 'pass' : 'FAIL'} |`),
    ...(live ? live.map((c) => `| 6 | ${c.name} (${c.detail}) | ${c.pass ? 'pass' : 'FAIL'} |`) : ['| 6 | live run | not run (pass --live) |']),
  ];
  return ['| Item | Check | Result |', '|---|---|---|', ...rows].join('\n');
}

export const describe: LiveScript['describe'] = () =>
  'S14 parity gate for CREW_ENGINE=langgraph: runs the offline checks of section 7 (no cost). With --live it also runs the Coffee Co. crew film on the native engine and on LangGraph and compares time and cost.';

export const estimateUsd: LiveScript['estimateUsd'] = (args = []) => (args.includes('--live') ? 2 : 0);

export const run: LiveScript['run'] = async ({ env, log, args = [] }) => {
  const offline = await runOffline();
  let live: Check[] | undefined;
  if (args.includes('--live')) {
    if (!env.metaApiKey) throw new Error('META_API_KEY is required for --live');
    const deps = await buildDeps(env);
    const model = process.env.WONDER_MODEL ?? 'muse-wonder-1.0';
    log('native engine...');
    process.env.CREW_ENGINE = 'native';
    const native = computeMetrics(await crewFilm(deps, log, model));
    log('langgraph engine...');
    process.env.CREW_ENGINE = 'langgraph';
    const graph = computeMetrics(await crewFilm(deps, log, model));
    live = liveVerdict(native, graph);
  }
  log(renderGate(offline, live));
  if (offline.some((r) => !r.pass) || live?.some((c) => !c.pass)) process.exitCode = 1;
};
