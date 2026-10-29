import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { z } from 'zod';
import { jobKindSchema, storyboardOpSchema, styleBibleSchema } from '../../shared/crew';
import type { ChatMessage, ToolCall, ToolSpec } from '../../shared/ports';
import { createMetaClients } from '../../server/meta';
import type { LiveScript } from './run';

export const describe: LiveScript['describe'] = () =>
  'MG-1: five planning turns against Muse Wonder (SHOWRUNNER_MODEL, default muse-wonder-1.0) with the four board tools. Records HTTP status, tool-call validity, parallel dispatch, latency and cost per turn';

export const estimateUsd: LiveScript['estimateUsd'] = () => 0.3;

/** The four board tools of design.md 6.3 that the probe offers. The real ones are built in S12b from the same shapes. */
export const boardToolSchemas = {
  setStyleBible: styleBibleSchema,
  reviseStoryboard: z.object({ ops: z.array(storyboardOpSchema).min(1).max(8), reason: z.string().min(1).max(200) }),
  dispatch: z.object({
    kind: jobKindSchema,
    sceneId: z.string().optional(),
    brief: z.string().min(1).max(600),
    reason: z.string().min(1).max(200),
    takes: z.union([z.literal(2), z.literal(3)]).optional(),
    dependsOn: z.array(z.string()).optional(),
  }),
  say: z.object({ text: z.string().min(1).max(240) }),
} as const;
export type BoardToolName = keyof typeof boardToolSchemas;

const DESCRIPTIONS: Record<BoardToolName, string> = {
  setStyleBible: 'Set the film style bible once, before the first build. It keeps every scene consistent.',
  reviseStoryboard: 'Add, update, remove or move scenes. 2 to 6 scenes, 2 to 8 seconds each, 30 seconds at most.',
  dispatch: 'Give one worker one job. brief is a concrete instruction; reason is one short line the user reads.',
  say: 'Say one short line to the user.',
};

const toolSpecs = (): ToolSpec[] =>
  (Object.keys(boardToolSchemas) as BoardToolName[]).map((name) => {
    const { $schema: _drop, ...parameters } = zodToJsonSchema(boardToolSchemas[name], { target: 'openApi3', $refStrategy: 'none' }) as Record<string, unknown>;
    return { type: 'function', function: { name, description: DESCRIPTIONS[name], parameters } };
  });

export interface CallCheck {
  name: string;
  valid: boolean;
  problem?: string;
}

/** A tool call is valid when it names a board tool and its arguments pass that tool's zod schema. */
export function checkToolCall(name: string, args: unknown): CallCheck {
  const schema = (boardToolSchemas as Record<string, z.ZodTypeAny>)[name];
  if (!schema) return { name, valid: false, problem: 'unknown tool' };
  const r = schema.safeParse(args);
  return r.success ? { name, valid: true } : { name, valid: false, problem: r.error.issues[0] ? `${r.error.issues[0].path.join('.')}: ${r.error.issues[0].message}` : 'invalid' };
}

export interface ProbeRun {
  run: number;
  status: number;
  ms: number;
  toolCalls: number;
  validCalls: number;
  dispatchCalls: number;
  /** All the calls are valid and there is at least one. */
  allValid: boolean;
  /** Two or more dispatch calls arrived in the same turn. */
  parallelDispatch: boolean;
  promptTokens: number;
  completionTokens: number;
  usd: number;
  problems: string[];
  error?: string;
}

export const PRICE_PER_M = { in: 4, out: 20 } as const;
export const priceUsd = (promptTokens: number, completionTokens: number) => (promptTokens * PRICE_PER_M.in + completionTokens * PRICE_PER_M.out) / 1_000_000;

export function scoreRun(run: number, status: number, ms: number, calls: ToolCall[], usage: { promptTokens: number; completionTokens: number } | undefined, error?: string): ProbeRun {
  const checks = calls.map((c) => checkToolCall(c.name, c.args));
  const dispatchCalls = calls.filter((c) => c.name === 'dispatch').length;
  const validCalls = checks.filter((c) => c.valid).length;
  const promptTokens = usage?.promptTokens ?? 0;
  const completionTokens = usage?.completionTokens ?? 0;
  return {
    run, status, ms, toolCalls: calls.length, validCalls, dispatchCalls,
    allValid: calls.length > 0 && validCalls === calls.length,
    parallelDispatch: dispatchCalls >= 2,
    promptTokens, completionTokens, usd: priceUsd(promptTokens, completionTokens),
    problems: checks.filter((c) => !c.valid).map((c) => `${c.name}: ${c.problem}`),
    ...(error ? { error } : {}),
  };
}

export interface ProbeVerdict {
  access: boolean;
  validRuns: number;
  parallelRuns: number;
  pass: boolean;
}

/** MG-1 pass marks (09 section 5): access 200, valid tool calls in at least 4 of 5 runs, parallel dispatch in at least 3 of 5. */
export function verdict(runs: ProbeRun[]): ProbeVerdict {
  const access = runs.some((r) => r.status === 200);
  const validRuns = runs.filter((r) => r.allValid).length;
  const parallelRuns = runs.filter((r) => r.parallelDispatch).length;
  return { access, validRuns, parallelRuns, pass: access && validRuns >= 4 && parallelRuns >= 3 };
}

const BRIEF = 'A 15 second film for "Northline", a fictional cold-brew coffee can: matte slate-blue can with a small orange mountain logo. Mood: calm morning, clean and premium. Show the can, the pour, and a closing line.';
const SYSTEM = `You are the showrunner of a small film crew making a short animated product film (10 to 30 seconds).
You never edit the timeline yourself. You direct the crew through tools.
Tools: setStyleBible (once, before the first build), reviseStoryboard (add scenes), dispatch (one job for one worker, kind build-scene), say (one line to the user).
You may call several tools in one turn. Dispatch independent scenes together so the crew works in parallel.`;

export const run: LiveScript['run'] = async ({ env, log }) => {
  const model = process.env.SHOWRUNNER_MODEL || env.SHOWRUNNER_MODEL;
  const spark = createMetaClients(env).spark;
  const tools = toolSpecs();
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: `New film. Brief: ${BRIEF}\nPlan it now: call setStyleBible, reviseStoryboard with the scenes, say one line, and dispatch a build-scene job for each scene.` },
  ];

  const runs: ProbeRun[] = [];
  for (let i = 1; i <= 5; i++) {
    const t0 = Date.now();
    try {
      const r = await spark.chat({ model, messages, tools, tool_choice: 'auto' });
      runs.push(scoreRun(i, 200, r.ms, r.toolCalls, r.usage));
    } catch (e) {
      const status = (e as { status?: number }).status ?? 0;
      runs.push(scoreRun(i, status, Date.now() - t0, [], undefined, (e as Error).message.slice(0, 200)));
    }
    const r = runs[i - 1]!;
    log(`run ${i}: status ${r.status} ${r.ms}ms calls ${r.toolCalls} valid ${r.validCalls} dispatch ${r.dispatchCalls} $${r.usd.toFixed(4)}${r.error ? ` ERROR ${r.error}` : ''}`);
    for (const p of r.problems) log(`  problem ${p}`);
  }

  const v = verdict(runs);
  const total = runs.reduce((n, r) => n + r.usd, 0);
  const meanMs = Math.round(runs.reduce((n, r) => n + r.ms, 0) / runs.length);
  log(`model ${model}: access ${v.access ? '200' : 'FAILED'}, valid tool calls in ${v.validRuns}/5, parallel dispatch in ${v.parallelRuns}/5, mean ${meanMs}ms, total $${total.toFixed(4)}`);
  log(v.pass ? 'PASS: use this model as SHOWRUNNER_MODEL' : 'FAIL: set SHOWRUNNER_MODEL=muse-spark-1.3-contributor');

  const file = new URL('../../debug/s12a/wonder-probe.json', import.meta.url);
  mkdirSync(dirname(file.pathname), { recursive: true });
  writeFileSync(file, JSON.stringify({ model, at: new Date().toISOString(), pricePerMillion: PRICE_PER_M, runs, verdict: v, totalUsd: total, meanMs }, null, 2));
  log('wrote debug/s12a/wonder-probe.json');
};
