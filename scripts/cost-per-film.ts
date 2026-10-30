// Owned by S10. `npx tsx scripts/cost-per-film.ts data/films/<id>/events.jsonl` (or a ledger .json): the table the README quotes.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { formatCostTable, ledgerFromEvents, summariseLedger, type Ledger } from './lib/cost-report';

export interface CostCliDeps {
  readFile?: (path: string) => string;
}

/** Returns the exit code and what to print: 0 for a table, 2 for a bad argument or a file that cannot be read. */
export function runCostCli(argv: string[], deps: CostCliDeps = {}): { code: number; output: string } {
  const file = argv.find((a) => !a.startsWith('--'));
  const usage = 'usage: tsx scripts/cost-per-film.ts <events.jsonl | ledger.json>';
  if (!file || !/\.(jsonl|json)$/.test(file)) return { code: 2, output: usage };
  const read = deps.readFile ?? ((p: string) => readFileSync(p, 'utf8'));
  let text: string;
  try {
    text = read(file);
  } catch {
    return { code: 2, output: `cannot read ${file}` };
  }
  try {
    const ledger = file.endsWith('.jsonl') ? ledgerFromEvents(text) : { ...(JSON.parse(text) as Ledger), skipped: 0 };
    const summary = summariseLedger(ledger);
    return { code: 0, output: `${formatCostTable(summary)}${summary.skipped ? `\nSkipped lines: ${summary.skipped}` : ''}` };
  } catch (e) {
    return { code: 2, output: `${file} is not valid: ${e instanceof Error ? e.message : String(e)}` };
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { code, output } = runCostCli(process.argv.slice(2));
  console.log(output);
  process.exitCode = code;
}
