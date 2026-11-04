// Owned by S10. `npx tsx scripts/preflight-submission.ts [--strict] [--json] [--only <id-prefix>]`: what still blocks the submission.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ALL_CHECKS } from './preflight/checks';
import { buildContext } from './preflight/context';
import { exitCode, formatResults, runChecks } from './preflight/run';
import type { NamedCheck, PreflightCtx } from './preflight/types';

export interface CliDeps {
  ctx: PreflightCtx;
  checks?: NamedCheck[];
  print?: (text: string) => void;
}

/** Runs the checks and prints them. Returns the process exit code. */
export function runCli(argv: string[], deps: CliDeps): number {
  const print = deps.print ?? ((t: string) => console.log(t));
  const strict = argv.includes('--strict');
  const onlyAt = argv.indexOf('--only');
  const only = onlyAt >= 0 ? argv[onlyAt + 1] : undefined;
  if (onlyAt >= 0 && !only) {
    print('usage: preflight-submission [--strict] [--json] [--only <id-prefix>]');
    return 2;
  }
  let results = runChecks(deps.checks ?? ALL_CHECKS, deps.ctx);
  if (only) results = results.filter((r) => r.id.startsWith(only));
  print(argv.includes('--json') ? JSON.stringify(results, null, 2) : formatResults(results));
  return exitCode(results, strict);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = runCli(process.argv.slice(2), { ctx: buildContext(resolve('.')) });
}
